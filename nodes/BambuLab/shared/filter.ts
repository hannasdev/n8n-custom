export type WatchedField = {
	raw: string[];
	key: string;
	threshold?: number;
};

export type ThresholdOptions = {
	layerThreshold: number;
	progressThreshold: number;
	tempThreshold: number;
	targetTempThreshold: number;
};

export const DEFAULT_THRESHOLDS: ThresholdOptions = {
	layerThreshold: 1,
	progressThreshold: 5,
	tempThreshold: 2,
	targetTempThreshold: 1,
};

export function buildWatchedFields(
	t: ThresholdOptions = DEFAULT_THRESHOLDS,
	enabledFields?: string[],
): WatchedField[] {
	const all: WatchedField[] = [
		{ raw: ['gcode_state', 'state'], key: 'state' },
		{ raw: ['print_type'], key: 'print_type' },
		{ raw: ['mc_print_stage', 'stage'], key: 'stage' },
		{ raw: ['subtask_name', 'task_name'], key: 'task_name' },
		{ raw: ['project_id'], key: 'project_id' },
		{ raw: ['mc_percent'], key: 'progress_pct', threshold: t.progressThreshold },
		// remaining_min is intentionally excluded: it's a constantly-ticking estimate
		// that would fire an event every minute regardless of any real state change.
		{ raw: ['layer_num'], key: 'current_layer', threshold: t.layerThreshold },
		{ raw: ['nozzle_temper', 'nozzle_temp_c'], key: 'nozzle_temp_c', threshold: t.tempThreshold },
		{ raw: ['bed_temper', 'bed_temp_c'], key: 'bed_temp_c', threshold: t.tempThreshold },
		{
			raw: ['chamber_temper', 'chamber_temp_c'],
			key: 'chamber_temp_c',
			threshold: t.tempThreshold,
		},
		{
			raw: ['nozzle_target_temper', 'nozzle_target_c'],
			key: 'nozzle_target_c',
			threshold: t.targetTempThreshold,
		},
		{
			raw: ['bed_target_temper', 'bed_target_c'],
			key: 'bed_target_c',
			threshold: t.targetTempThreshold,
		},
		{ raw: ['print_error'], key: 'error_code' },
		{ raw: ['spd_lvl'], key: 'speed_level' },
		// Fan speeds are excluded: they fluctuate by ±1 unit continuously and are
		// available in output but should not drive trigger events.
	];
	return enabledFields ? all.filter((f) => enabledFields.includes(f.key)) : all;
}

// Backwards-compatible default export used by tests that don't need custom thresholds
export const WATCHED_FIELDS: WatchedField[] = buildWatchedFields();

/**
 * Extracts the printer state string from a raw MQTT payload.
 * Checks `parsed.print.gcode_state`, then `parsed.print.state`, then top-level
 * equivalents. Returns null if the field is absent, null, or empty — indicating
 * a partial frame that carries no state information.
 */
export function extractGcodeState(parsed: Record<string, unknown>): string | null {
	const print = (parsed.print as Record<string, unknown> | undefined) ?? parsed;
	const raw = print.gcode_state ?? print.state;
	if (raw === undefined || raw === null || raw === '') return null;
	return String(raw);
}

export type FieldChange = { key: string; from: unknown; to: unknown };

/**
 * Maps each summarized output field to the raw source keys that produce it.
 * A field is considered "present" in a frame if at least one source key is
 * defined on the raw `print` object. Used by mergeOutput to prevent partial
 * frames from overwriting accumulated state with summarizeStatus defaults.
 */
export const OUTPUT_SOURCES: Record<string, string[]> = {
	state: ['gcode_state', 'state'],
	print_type: ['print_type'],
	stage: ['mc_print_stage', 'stage'],
	progress_pct: ['mc_percent', 'progress_pct'],
	remaining_min: ['mc_remaining_time', 'remaining_min'],
	current_layer: ['layer_num', 'current_layer'],
	total_layers: ['total_layer_num', 'total_layers'],
	task_name: ['subtask_name', 'task_name'],
	project_id: ['project_id'],
	profile_id: ['profile_id'],
	task_id: ['task_id'],
	subtask_id: ['subtask_id'],
	wifi_signal: ['wifi_signal'],
	local_ip: ['net', 'local_ip'],
	nozzle_temp_c: ['nozzle_temper', 'nozzle_temp_c'],
	nozzle_target_c: ['nozzle_target_temper', 'nozzle_target_c'],
	bed_temp_c: ['bed_temper', 'bed_temp_c'],
	bed_target_c: ['bed_target_temper', 'bed_target_c'],
	chamber_temp_c: ['chamber_temper', 'chamber_temp_c'],
	heatbreak_fan_speed: ['heatbreak_fan_speed'],
	cooling_fan_speed: ['cooling_fan_speed'],
	aux_fan1_speed: ['big_fan1_speed', 'aux_fan1_speed'],
	aux_fan2_speed: ['big_fan2_speed', 'aux_fan2_speed'],
	speed_level: ['spd_lvl', 'speed_level'],
	speed_percent: ['spd_mag', 'speed_percent'],
	error_code: ['print_error', 'error_code'],
	chamber_light: ['lights_report'],
	ams_status: ['ams_status'],
	active_tray_id: ['vt_tray', 'active_tray_id'],
	tray_type: ['vt_tray', 'tray_type'],
	tray_material: ['vt_tray', 'tray_material'],
	tray_color: ['vt_tray', 'tray_color'],
	tray_k: ['vt_tray', 'tray_k'],
	nozzle_diameter: ['nozzle_diameter'],
	nozzle_type: ['nozzle_type'],
	sdcard_mounted: ['sdcard_mounted', 'sdcard'],
	printer_online: ['printer_online', 'online'],
};

/**
 * Merges a newly summarized frame into an accumulated output snapshot.
 * Only overwrites a field when at least one of its raw source keys is present
 * in the frame — absent fields keep their previously accumulated value.
 * `received_at` is always updated from the current frame.
 * Does not mutate `previousOutput`.
 */
export function mergeOutput(
	currentSummary: Record<string, unknown>,
	previousOutput: Record<string, unknown>,
	print: Record<string, unknown>,
	sources: Record<string, string[]> = OUTPUT_SOURCES,
): Record<string, unknown> {
	const result = { ...previousOutput };
	for (const [key, rawSources] of Object.entries(sources)) {
		if (rawSources.some((s) => print[s] !== undefined)) {
			result[key] = currentSummary[key];
		}
	}
	result.received_at = currentSummary.received_at;
	return result;
}

/**
 * Compares watched fields from a raw MQTT `print` frame against `lastValues`.
 * Returns the list of changed fields and an updated (shallow) copy of lastValues.
 *
 * Design rules:
 * - Fields absent (undefined/null) in the frame are skipped entirely — partial
 *   MQTT frames must never overwrite or falsely reset a previously seen value.
 * - For the first source key that is present in the frame, subsequent keys are
 *   ignored (first-one-wins within a `raw` list).
 * - Numeric fields with a threshold only fire when |new − prev| >= threshold.
 * - `lastValues` is never mutated; `nextValues` is a new object.
 */
export function checkFieldChanges(
	print: Record<string, unknown>,
	lastValues: Record<string, unknown>,
	watched: WatchedField[] = WATCHED_FIELDS,
): { changed: FieldChange[]; nextValues: Record<string, unknown> } {
	const nextValues = { ...lastValues };
	const changed: FieldChange[] = [];

	for (const { raw, key, threshold } of watched) {
		const value = raw.map((f) => print[f]).find((v) => v !== undefined && v !== null);
		if (value === undefined) continue; // field absent from this frame

		const prev = nextValues[key];
		const isChange =
			typeof value === 'number' && threshold !== undefined
				? prev === undefined || Math.abs(value - (prev as number)) >= threshold
				: prev === undefined || value !== prev;

		if (isChange) {
			changed.push({ key, from: prev, to: value });
			nextValues[key] = value;
		}
	}

	return { changed, nextValues };
}
