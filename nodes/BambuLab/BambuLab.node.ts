import type {
	IDataObject,
	IExecuteFunctions,
	INode,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { mqttRequest, PUSH_ALL, type BambuLanCredentials } from './shared/mqttClient';

const PRINT_COMMANDS = {
	pause: { print: { sequence_id: '0', command: 'pause', param: '' } },
	resume: { print: { sequence_id: '0', command: 'resume', param: '' } },
	cancel: { print: { sequence_id: '0', command: 'stop', param: '' } },
} as const;

const OPERATION_TO_COMMAND: Record<string, string> = {
	getStatus: 'pushall',
	pausePrint: 'pause',
	resumePrint: 'resume',
	cancelPrint: 'stop',
};

function decodePackedIpv4(value: unknown): string {
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return '';
	}

	return [0, 8, 16, 24].map((shift) => String((value >> shift) & 255)).join('.');
}

function summarizeStatus(response: IDataObject): IDataObject {
	const print = ((response.print as IDataObject | undefined) ?? response) as IDataObject;
	const tray = (print.vt_tray as IDataObject | undefined) ?? {};
	const online = (print.online as IDataObject | undefined) ?? {};
	const lights = Array.isArray(print.lights_report) ? (print.lights_report as IDataObject[]) : [];
	const net = (print.net as IDataObject | undefined) ?? {};
	const netInfo = Array.isArray(net.info) ? (net.info as IDataObject[]) : [];
	const primaryNetInfo = netInfo[0] ?? {};

	return {
		state: print.gcode_state ?? 'unknown',
		print_type: print.print_type ?? 'unknown',
		stage: print.mc_print_stage ?? null,
		progress_pct: Number(print.mc_percent ?? 0),
		remaining_min: Number(print.mc_remaining_time ?? 0),
		current_layer: Number(print.layer_num ?? 0),
		total_layers: Number(print.total_layer_num ?? 0),
		task_name: print.subtask_name ?? '',
		project_id: print.project_id ?? '',
		profile_id: print.profile_id ?? '',
		task_id: print.task_id ?? '',
		subtask_id: print.subtask_id ?? '',
		wifi_signal: print.wifi_signal ?? '',
		local_ip: decodePackedIpv4(primaryNetInfo.ip),
		nozzle_temp_c: Number(print.nozzle_temper ?? 0),
		nozzle_target_c: Number(print.nozzle_target_temper ?? 0),
		bed_temp_c: Number(print.bed_temper ?? 0),
		bed_target_c: Number(print.bed_target_temper ?? 0),
		chamber_temp_c: Number(print.chamber_temper ?? 0),
		heatbreak_fan_speed: Number(print.heatbreak_fan_speed ?? 0),
		cooling_fan_speed: Number(print.cooling_fan_speed ?? 0),
		aux_fan1_speed: Number(print.big_fan1_speed ?? 0),
		aux_fan2_speed: Number(print.big_fan2_speed ?? 0),
		speed_level: Number(print.spd_lvl ?? 0),
		speed_percent: Number(print.spd_mag ?? 0),
		error_code: Number(print.print_error ?? 0),
		chamber_light: lights.find((light) => light.node === 'chamber_light')?.mode ?? '',
		ams_status: Number(print.ams_status ?? 0),
		active_tray_id: tray.id ?? '',
		tray_type: tray.tray_type ?? '',
		tray_material: tray.tray_info_idx ?? '',
		tray_color: tray.tray_color ?? '',
		tray_k: tray.k ?? null,
		nozzle_diameter: print.nozzle_diameter ?? '',
		nozzle_type: print.nozzle_type ?? '',
		sdcard_mounted: Boolean(print.sdcard),
		printer_online: Boolean(online.version || online.ahb || online.rfid),
	};
}

function summarizeCommandResult(
	operation: string,
	response: IDataObject,
	rawCommand: string | object | undefined,
): IDataObject {
	const print = ((response.print as IDataObject | undefined) ?? response) as IDataObject;
	const responseMsg = Number(print.msg ?? response.msg ?? 0);
	const responseErrorCode = Number(print.print_error ?? response.print_error ?? 0);
	let commandPayload: IDataObject | undefined;

	if (typeof rawCommand === 'string') {
		try {
			commandPayload = JSON.parse(rawCommand) as IDataObject;
		} catch {
			commandPayload = undefined;
		}
	} else if (typeof rawCommand === 'object' && rawCommand !== null) {
		commandPayload = rawCommand as IDataObject;
	}

	const requestedCommandFromJson =
		(commandPayload?.print as IDataObject | undefined)?.command ??
		(commandPayload?.pushing as IDataObject | undefined)?.command ??
		commandPayload?.command;
	const requestedCommand = String(
		requestedCommandFromJson ?? OPERATION_TO_COMMAND[operation] ?? 'unknown',
	);
	const responseCommand = String(print.command ?? response.command ?? '');

	return {
		requested_operation: operation,
		requested_command: requestedCommand,
		response_command: responseCommand,
		response_msg: responseMsg,
		response_error_code: responseErrorCode,
		accepted: responseMsg === 0 && responseErrorCode === 0,
		note:
			responseMsg === 0 && responseErrorCode === 0
				? 'Command accepted by printer (or no error reported)'
				: 'Printer reported an error or non-zero response code',
		status: summarizeStatus(response),
	};
}

function commandForOperation(
	operation: string,
	rawCommand: string | object | undefined,
	node: INode,
): object {
	if (operation === 'getStatus') {
		return PUSH_ALL;
	}

	if (operation === 'sendCommand') {
		if (rawCommand === undefined) {
			throw new NodeOperationError(node, 'Command is required for the Send Command operation');
		}

		return typeof rawCommand === 'string' ? (JSON.parse(rawCommand) as object) : rawCommand;
	}

	if (operation === 'pausePrint') return PRINT_COMMANDS.pause;
	if (operation === 'resumePrint') return PRINT_COMMANDS.resume;
	if (operation === 'cancelPrint') return PRINT_COMMANDS.cancel;

	throw new NodeOperationError(node, `Unknown operation: ${operation}`);
}

export class BambuLab implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bambu Lab Printer',
		name: 'bambuLab',
		icon: 'fa:cube',
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"]}}',
		description: 'Interact with a Bambu Lab printer over the local network via MQTT',
		defaults: {
			name: 'Bambu Lab Printer',
		},
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'bambuLabLanApi',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				options: [
					{
						name: 'Get Status',
						value: 'getStatus',
						description:
							'Request a full status push from the printer and return the raw report payload',
						action: 'Get printer status',
					},
					{
						name: 'Pause Print',
						value: 'pausePrint',
						description: 'Pause the currently running print',
						action: 'Pause the current print',
					},
					{
						name: 'Resume Print',
						value: 'resumePrint',
						description: 'Resume a paused print',
						action: 'Resume the current print',
					},
					{
						name: 'Cancel Print',
						value: 'cancelPrint',
						description: 'Stop the current print',
						action: 'Cancel the current print',
					},
					{
						name: 'Send Command',
						value: 'sendCommand',
						description:
							'Publish a raw JSON command to the printer and return the first report message received',
						action: 'Send a command to the printer',
					},
				],
				default: 'getStatus',
			},
			{
				displayName: 'Response Mode',
				name: 'responseMode',
				type: 'options',
				options: [
					{
						name: 'Summary',
						value: 'summary',
						description: 'Return a normalized printer status summary',
					},
					{
						name: 'Raw',
						value: 'raw',
						description: 'Return the raw MQTT response from the printer',
					},
				],
				default: 'summary',
				description: 'Whether to return the raw printer response or a normalized summary',
			},
			{
				displayName: 'Command (JSON)',
				name: 'command',
				type: 'json',
				default: '{}',
				required: true,
				description:
					'JSON object to publish to device/&lt;serial&gt;/request. See Bambu MQTT docs for command formats.',
				displayOptions: {
					show: {
						operation: ['sendCommand'],
					},
				},
			},
			{
				displayName: 'Timeout (ms)',
				name: 'timeoutMs',
				type: 'number',
				default: 10000,
				description: 'How long to wait for a printer response before failing',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			const operation = this.getNodeParameter('operation', i) as string;
			const responseMode = this.getNodeParameter('responseMode', i) as string;
			const timeoutMs = this.getNodeParameter('timeoutMs', i) as number;
			const rawCredentials = await this.getCredentials('bambuLabLanApi');

			const credentials: BambuLanCredentials = {
				host: rawCredentials.host as string,
				serial: (rawCredentials.serial as string).toUpperCase(),
				accessCode: rawCredentials.accessCode as string,
			};

			try {
				const rawCommand =
					operation === 'sendCommand'
						? (this.getNodeParameter('command', i) as string | object)
						: undefined;
				const command = commandForOperation(operation, rawCommand, this.getNode());
				const response = await mqttRequest(credentials, command, timeoutMs);
				const output =
					responseMode === 'raw'
						? (response as IDataObject)
						: operation === 'getStatus'
							? summarizeStatus(response as IDataObject)
							: summarizeCommandResult(operation, response as IDataObject, rawCommand);

				returnData.push({
					json: output,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
				} else {
					throw error;
				}
			}
		}

		return [returnData];
	}
}
