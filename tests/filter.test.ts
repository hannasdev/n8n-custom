import { describe, it, expect } from 'vitest';
import {
	extractGcodeState,
	checkFieldChanges,
	mergeOutput,
	type WatchedField,
} from '../nodes/BambuLab/shared/filter';

// ---------------------------------------------------------------------------
// extractGcodeState
// ---------------------------------------------------------------------------

describe('extractGcodeState', () => {
	it('returns gcode_state from nested print object', () => {
		expect(extractGcodeState({ print: { gcode_state: 'RUNNING' } })).toBe('RUNNING');
	});

	it('falls back to print.state when gcode_state is absent', () => {
		expect(extractGcodeState({ print: { state: 'IDLE' } })).toBe('IDLE');
	});

	it('falls back to top-level gcode_state when print key is absent', () => {
		expect(extractGcodeState({ gcode_state: 'PAUSE' })).toBe('PAUSE');
	});

	it('falls back to top-level state', () => {
		expect(extractGcodeState({ state: 'FINISH' })).toBe('FINISH');
	});

	it('returns null when no state field is present', () => {
		expect(extractGcodeState({ print: { bed_temper: 60 } })).toBeNull();
	});

	it('returns null for empty string state', () => {
		expect(extractGcodeState({ print: { gcode_state: '' } })).toBeNull();
	});

	it('returns null for null state', () => {
		expect(extractGcodeState({ print: { gcode_state: null } })).toBeNull();
	});

	it('coerces numeric state to string', () => {
		expect(extractGcodeState({ print: { gcode_state: 0 } })).toBe('0');
	});

	it('returns null for empty payload', () => {
		expect(extractGcodeState({})).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// checkFieldChanges — helpers
// ---------------------------------------------------------------------------

const EXACT_FIELD: WatchedField[] = [{ raw: ['gcode_state'], key: 'state' }];
const THRESHOLD_2: WatchedField[] = [{ raw: ['bed_temper'], key: 'bed_temp_c', threshold: 2 }];
const THRESHOLD_1: WatchedField[] = [
	{ raw: ['bed_target_temper'], key: 'bed_target_c', threshold: 1 },
];
const MULTI_RAW: WatchedField[] = [
	{ raw: ['nozzle_temper', 'nozzle_temp_c'], key: 'nozzle_temp_c', threshold: 2 },
];

// ---------------------------------------------------------------------------
// checkFieldChanges — first call (empty lastValues)
// ---------------------------------------------------------------------------

describe('checkFieldChanges — first call', () => {
	it('reports all present fields as changed when lastValues is empty', () => {
		const { changed } = checkFieldChanges({ gcode_state: 'IDLE' }, {}, EXACT_FIELD);
		expect(changed).toHaveLength(1);
		expect(changed[0]).toEqual({ key: 'state', from: undefined, to: 'IDLE' });
	});

	it('sets from to undefined on first call', () => {
		const { changed } = checkFieldChanges({ bed_temper: 60 }, {}, THRESHOLD_2);
		expect(changed[0].from).toBeUndefined();
		expect(changed[0].to).toBe(60);
	});

	it('includes the new value in nextValues', () => {
		const { nextValues } = checkFieldChanges({ gcode_state: 'RUNNING' }, {}, EXACT_FIELD);
		expect(nextValues.state).toBe('RUNNING');
	});
});

// ---------------------------------------------------------------------------
// checkFieldChanges — exact-match fields (no threshold)
// ---------------------------------------------------------------------------

describe('checkFieldChanges — exact match', () => {
	it('reports no change when value is identical', () => {
		const { changed } = checkFieldChanges({ gcode_state: 'IDLE' }, { state: 'IDLE' }, EXACT_FIELD);
		expect(changed).toHaveLength(0);
	});

	it('reports change when value differs', () => {
		const { changed } = checkFieldChanges(
			{ gcode_state: 'RUNNING' },
			{ state: 'IDLE' },
			EXACT_FIELD,
		);
		expect(changed).toHaveLength(1);
		expect(changed[0]).toEqual({ key: 'state', from: 'IDLE', to: 'RUNNING' });
	});

	it('updates nextValues to the new value', () => {
		const { nextValues } = checkFieldChanges(
			{ gcode_state: 'RUNNING' },
			{ state: 'IDLE' },
			EXACT_FIELD,
		);
		expect(nextValues.state).toBe('RUNNING');
	});
});

// ---------------------------------------------------------------------------
// checkFieldChanges — threshold fields
// ---------------------------------------------------------------------------

describe('checkFieldChanges — numeric threshold', () => {
	it('does not fire when delta is below threshold', () => {
		const { changed } = checkFieldChanges({ bed_temper: 60.5 }, { bed_temp_c: 60 }, THRESHOLD_2);
		expect(changed).toHaveLength(0);
	});

	it('does not fire when delta equals threshold minus epsilon', () => {
		const { changed } = checkFieldChanges({ bed_temper: 61.9 }, { bed_temp_c: 60 }, THRESHOLD_2);
		expect(changed).toHaveLength(0);
	});

	it('fires when delta equals threshold exactly', () => {
		const { changed } = checkFieldChanges({ bed_temper: 62 }, { bed_temp_c: 60 }, THRESHOLD_2);
		expect(changed).toHaveLength(1);
		expect(changed[0].to).toBe(62);
	});

	it('fires when delta exceeds threshold', () => {
		const { changed } = checkFieldChanges({ bed_temper: 80 }, { bed_temp_c: 60 }, THRESHOLD_2);
		expect(changed).toHaveLength(1);
	});

	it('fires when value drops by at least threshold (negative delta)', () => {
		const { changed } = checkFieldChanges({ bed_temper: 58 }, { bed_temp_c: 60 }, THRESHOLD_2);
		expect(changed).toHaveLength(1);
		expect(changed[0]).toEqual({ key: 'bed_temp_c', from: 60, to: 58 });
	});

	it('respects a threshold of 1 correctly', () => {
		const below = checkFieldChanges({ bed_target_temper: 60.5 }, { bed_target_c: 60 }, THRESHOLD_1);
		expect(below.changed).toHaveLength(0);

		const exact = checkFieldChanges({ bed_target_temper: 61 }, { bed_target_c: 60 }, THRESHOLD_1);
		expect(exact.changed).toHaveLength(1);
	});
});

// ---------------------------------------------------------------------------
// checkFieldChanges — partial frames
// ---------------------------------------------------------------------------

describe('checkFieldChanges — partial frames', () => {
	it('skips fields absent from the frame entirely', () => {
		// Frame contains only gcode_state, not bed_temper
		const fields: WatchedField[] = [
			{ raw: ['gcode_state'], key: 'state' },
			{ raw: ['bed_temper'], key: 'bed_temp_c', threshold: 2 },
		];
		const { changed, nextValues } = checkFieldChanges(
			{ gcode_state: 'RUNNING' },
			{ state: 'IDLE', bed_temp_c: 60 },
			fields,
		);
		expect(changed.map((c) => c.key)).toEqual(['state']);
		// bed_temp_c must not be overwritten
		expect(nextValues.bed_temp_c).toBe(60);
	});

	it('skips fields with null values', () => {
		const { changed } = checkFieldChanges({ bed_temper: null }, { bed_temp_c: 60 }, THRESHOLD_2);
		expect(changed).toHaveLength(0);
	});

	it('does not mutate the original lastValues object', () => {
		const lastValues = { state: 'IDLE' };
		checkFieldChanges({ gcode_state: 'RUNNING' }, lastValues, EXACT_FIELD);
		expect(lastValues.state).toBe('IDLE');
	});
});

// ---------------------------------------------------------------------------
// checkFieldChanges — multi-source raw fields
// ---------------------------------------------------------------------------

describe('checkFieldChanges — multi-source raw fields', () => {
	it('uses the first raw key that is present', () => {
		// nozzle_temper is present — should take priority over nozzle_temp_c
		const { changed } = checkFieldChanges(
			{ nozzle_temper: 200, nozzle_temp_c: 100 },
			{ nozzle_temp_c: 0 },
			MULTI_RAW,
		);
		expect(changed[0].to).toBe(200);
	});

	it('falls back to the second raw key when the first is absent', () => {
		const { changed } = checkFieldChanges({ nozzle_temp_c: 200 }, { nozzle_temp_c: 0 }, MULTI_RAW);
		expect(changed[0].to).toBe(200);
	});

	it('skips the field when all raw keys are absent', () => {
		const { changed } = checkFieldChanges({}, { nozzle_temp_c: 200 }, MULTI_RAW);
		expect(changed).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// checkFieldChanges — multiple fields in one frame
// ---------------------------------------------------------------------------

describe('checkFieldChanges — multiple fields', () => {
	const FIELDS: WatchedField[] = [
		{ raw: ['gcode_state'], key: 'state' },
		{ raw: ['mc_percent'], key: 'progress_pct', threshold: 1 },
		{ raw: ['bed_temper'], key: 'bed_temp_c', threshold: 2 },
	];

	it('reports all changed fields in a single call', () => {
		const { changed } = checkFieldChanges(
			{ gcode_state: 'RUNNING', mc_percent: 50, bed_temper: 60 },
			{ state: 'IDLE', progress_pct: 10, bed_temp_c: 20 },
			FIELDS,
		);
		expect(changed.map((c) => c.key)).toEqual(['state', 'progress_pct', 'bed_temp_c']);
	});

	it('only returns fields that actually changed', () => {
		const { changed } = checkFieldChanges(
			{ gcode_state: 'RUNNING', mc_percent: 50, bed_temper: 60 },
			{ state: 'RUNNING', progress_pct: 50, bed_temp_c: 60 },
			FIELDS,
		);
		expect(changed).toHaveLength(0);
	});

	it('accumulates nextValues for all changed fields', () => {
		const { nextValues } = checkFieldChanges(
			{ gcode_state: 'FINISH', mc_percent: 100, bed_temper: 25 },
			{ state: 'RUNNING', progress_pct: 90, bed_temp_c: 60 },
			FIELDS,
		);
		expect(nextValues.state).toBe('FINISH');
		expect(nextValues.progress_pct).toBe(100);
		expect(nextValues.bed_temp_c).toBe(25);
	});
});

// ---------------------------------------------------------------------------
// mergeOutput
// ---------------------------------------------------------------------------

describe('mergeOutput', () => {
	const SOURCES: Record<string, string[]> = {
		state: ['gcode_state'],
		bed_temp_c: ['bed_temper'],
		nozzle_temp_c: ['nozzle_temper'],
		task_name: ['subtask_name'],
	};

	it('overlays present fields from currentSummary onto previousOutput', () => {
		const result = mergeOutput(
			{
				state: 'RUNNING',
				bed_temp_c: 60,
				nozzle_temp_c: 200,
				task_name: 'my_print',
				received_at: 'now',
			},
			{ state: 'IDLE', bed_temp_c: 20, nozzle_temp_c: 20, task_name: '', received_at: 'before' },
			{ gcode_state: 'RUNNING', bed_temper: 60, nozzle_temper: 200, subtask_name: 'my_print' },
			SOURCES,
		);
		expect(result.state).toBe('RUNNING');
		expect(result.bed_temp_c).toBe(60);
	});

	it('keeps previousOutput value when source key is absent from frame', () => {
		// Only bed_temper present — nozzle_temper, gcode_state, subtask_name absent
		const result = mergeOutput(
			{ state: 'unknown', bed_temp_c: 60, nozzle_temp_c: 0, task_name: '', received_at: 'now' },
			{
				state: 'RUNNING',
				bed_temp_c: 20,
				nozzle_temp_c: 200,
				task_name: 'my_print',
				received_at: 'before',
			},
			{ bed_temper: 60 },
			SOURCES,
		);
		expect(result.bed_temp_c).toBe(60); // updated
		expect(result.state).toBe('RUNNING'); // preserved
		expect(result.nozzle_temp_c).toBe(200); // preserved
		expect(result.task_name).toBe('my_print'); // preserved
	});

	it('always updates received_at regardless of sources', () => {
		const result = mergeOutput(
			{ received_at: '2026-01-01T12:00:00Z' },
			{ received_at: '2026-01-01T11:00:00Z' },
			{},
			SOURCES,
		);
		expect(result.received_at).toBe('2026-01-01T12:00:00Z');
	});

	it('does not mutate previousOutput', () => {
		const prev = { state: 'IDLE', bed_temp_c: 20, received_at: 'before' };
		mergeOutput(
			{ state: 'RUNNING', bed_temp_c: 60, received_at: 'now' },
			prev,
			{ gcode_state: 'RUNNING', bed_temper: 60 },
			SOURCES,
		);
		expect(prev.state).toBe('IDLE');
		expect(prev.bed_temp_c).toBe(20);
	});

	it('builds a correct accumulated snapshot across two partial frames', () => {
		// First frame: full state
		const after1 = mergeOutput(
			{ state: 'RUNNING', bed_temp_c: 60, nozzle_temp_c: 200, task_name: 'job', received_at: 't1' },
			{},
			{ gcode_state: 'RUNNING', bed_temper: 60, nozzle_temper: 200, subtask_name: 'job' },
			SOURCES,
		);
		expect(after1).toMatchObject({
			state: 'RUNNING',
			bed_temp_c: 60,
			nozzle_temp_c: 200,
			task_name: 'job',
		});

		// Second frame: only bed_temper changes
		const after2 = mergeOutput(
			{ state: 'unknown', bed_temp_c: 80, nozzle_temp_c: 0, task_name: '', received_at: 't2' },
			after1,
			{ bed_temper: 80 },
			SOURCES,
		);
		expect(after2.bed_temp_c).toBe(80); // updated
		expect(after2.nozzle_temp_c).toBe(200); // preserved from frame 1
		expect(after2.state).toBe('RUNNING'); // preserved from frame 1
		expect(after2.task_name).toBe('job'); // preserved from frame 1
		expect(after2.received_at).toBe('t2'); // always updated
	});
});
