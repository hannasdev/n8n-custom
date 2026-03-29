export type WatchedField = {
	raw: string[];
	key: string;
	threshold?: number;
};

export const WATCHED_FIELDS: WatchedField[] = [
	{ raw: ['gcode_state', 'state'], key: 'state' },
	{ raw: ['print_type'], key: 'print_type' },
	{ raw: ['mc_print_stage', 'stage'], key: 'stage' },
	{ raw: ['subtask_name', 'task_name'], key: 'task_name' },
	{ raw: ['project_id'], key: 'project_id' },
	{ raw: ['mc_percent'], key: 'progress_pct', threshold: 1 },
	{ raw: ['mc_remaining_time'], key: 'remaining_min', threshold: 1 },
	{ raw: ['layer_num'], key: 'current_layer', threshold: 1 },
	// Actual temps: 2 °C threshold absorbs idle sensor wobble
	{ raw: ['nozzle_temper', 'nozzle_temp_c'], key: 'nozzle_temp_c', threshold: 2 },
	{ raw: ['bed_temper', 'bed_temp_c'], key: 'bed_temp_c', threshold: 2 },
	{ raw: ['chamber_temper', 'chamber_temp_c'], key: 'chamber_temp_c', threshold: 2 },
	// Target temps: 1 °C — targets are set deliberately so even small changes matter
	{ raw: ['nozzle_target_temper', 'nozzle_target_c'], key: 'nozzle_target_c', threshold: 1 },
	{ raw: ['bed_target_temper', 'bed_target_c'], key: 'bed_target_c', threshold: 1 },
	{ raw: ['print_error'], key: 'error_code' },
	{ raw: ['spd_lvl'], key: 'speed_level' },
];

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
