import { describe, it, expect } from 'vitest';
import { summarizeStatus, decodePackedIpv4 } from '../nodes/BambuLab/shared/summarize';

// ---------------------------------------------------------------------------
// decodePackedIpv4
// ---------------------------------------------------------------------------

describe('decodePackedIpv4', () => {
	it('decodes a packed IPv4 integer to dotted-decimal', () => {
		// 10.0.0.1 packed little-endian: (1 << 24) | (0 << 16) | (0 << 8) | 10
		const packed = (1 << 24) | (0 << 16) | (0 << 8) | 10;
		expect(decodePackedIpv4(packed)).toBe('10.0.0.1');
	});

	it('returns empty string for non-numeric input', () => {
		expect(decodePackedIpv4('not-a-number')).toBe('');
		expect(decodePackedIpv4(null)).toBe('');
		expect(decodePackedIpv4(undefined)).toBe('');
	});

	it('returns empty string for non-finite numbers', () => {
		expect(decodePackedIpv4(NaN)).toBe('');
		expect(decodePackedIpv4(Infinity)).toBe('');
	});
});

// ---------------------------------------------------------------------------
// summarizeStatus — payload shapes
// ---------------------------------------------------------------------------

describe('summarizeStatus', () => {
	it('handles a full wrapped payload (print: {...})', () => {
		const payload = {
			print: {
				gcode_state: 'RUNNING',
				mc_percent: 42,
				layer_num: 10,
				total_layer_num: 100,
				subtask_name: 'TestPrint',
				nozzle_temper: 220,
				bed_temper: 65,
				wifi_signal: '-55dBm',
				print_error: 0,
			},
		};

		const result = summarizeStatus(payload);

		expect(result.state).toBe('RUNNING');
		expect(result.progress_pct).toBe(42);
		expect(result.current_layer).toBe(10);
		expect(result.total_layers).toBe(100);
		expect(result.task_name).toBe('TestPrint');
		expect(result.nozzle_temp_c).toBe(220);
		expect(result.bed_temp_c).toBe(65);
		expect(result.wifi_signal).toBe('-55dBm');
		expect(result.error_code).toBe(0);
	});

	it('handles an unwrapped payload (no print wrapper)', () => {
		const payload = {
			gcode_state: 'IDLE',
			mc_percent: 0,
		};

		const result = summarizeStatus(payload);

		expect(result.state).toBe('IDLE');
		expect(result.progress_pct).toBe(0);
	});

	it('returns "unknown" state when gcode_state is absent', () => {
		const payload = { print: { wifi_signal: '-61dBm' } };
		const result = summarizeStatus(payload);
		expect(result.state).toBe('unknown');
	});

	it('falls back to normalized key names (already-normalized payload)', () => {
		const payload = {
			state: 'FINISH',
			progress_pct: 100,
			nozzle_temp_c: 0,
		};

		const result = summarizeStatus(payload);
		expect(result.state).toBe('FINISH');
		expect(result.progress_pct).toBe(100);
	});

	it('uses mc_percent fallback chain (nozzle_temper → nozzle_temp_c)', () => {
		const payload = {
			print: {
				gcode_state: 'RUNNING',
				nozzle_temp_c: 215, // fallback field (no nozzle_temper)
				bed_target_temper: 60,
			},
		};

		const result = summarizeStatus(payload);
		expect(result.nozzle_temp_c).toBe(215);
		expect(result.bed_target_c).toBe(60);
	});

	it('decodes packed IPv4 from net.info', () => {
		const packed = (1 << 24) | (0 << 16) | (0 << 8) | 10;
		const payload = {
			print: {
				gcode_state: 'IDLE',
				net: { info: [{ ip: packed }] },
			},
		};

		const result = summarizeStatus(payload);
		expect(result.local_ip).toBe('10.0.0.1');
	});

	it('extracts chamber_light from lights_report array', () => {
		const payload = {
			print: {
				gcode_state: 'IDLE',
				lights_report: [
					{ node: 'work_light', mode: 'off' },
					{ node: 'chamber_light', mode: 'on' },
				],
			},
		};

		const result = summarizeStatus(payload);
		expect(result.chamber_light).toBe('on');
	});

	it('returns empty chamber_light when lights_report is missing', () => {
		const payload = { print: { gcode_state: 'IDLE' } };
		const result = summarizeStatus(payload);
		expect(result.chamber_light).toBe('');
	});

	it('reads tray info from vt_tray', () => {
		const payload = {
			print: {
				gcode_state: 'RUNNING',
				vt_tray: { id: '1', tray_type: 'PLA', tray_color: 'FF0000FF' },
			},
		};

		const result = summarizeStatus(payload);
		expect(result.active_tray_id).toBe('1');
		expect(result.tray_type).toBe('PLA');
		expect(result.tray_color).toBe('FF0000FF');
	});

	it('derives printer_online from online sub-object', () => {
		const payload = {
			print: {
				gcode_state: 'IDLE',
				online: { version: 1, ahb: false, rfid: false },
			},
		};

		const result = summarizeStatus(payload);
		expect(result.printer_online).toBe(true);
	});

	it('returns printer_online false when online object is empty', () => {
		const payload = {
			print: { gcode_state: 'IDLE', online: { version: 0, ahb: false, rfid: false } },
		};

		const result = summarizeStatus(payload);
		expect(result.printer_online).toBe(false);
	});

	it('coerces error_code from print_error field', () => {
		const payload = { print: { gcode_state: 'IDLE', print_error: 50331904 } };
		const result = summarizeStatus(payload);
		expect(result.error_code).toBe(50331904);
	});

	it('includes received_at as an ISO timestamp string', () => {
		const before = Date.now();
		const result = summarizeStatus({ print: { gcode_state: 'IDLE' } });
		const after = Date.now();

		const ts = new Date(result.received_at as string).getTime();
		expect(ts).toBeGreaterThanOrEqual(before);
		expect(ts).toBeLessThanOrEqual(after);
	});
});
