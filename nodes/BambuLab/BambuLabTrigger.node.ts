import type {
	IDataObject,
	INodeType,
	INodeTypeDescription,
	ITriggerFunctions,
	ITriggerResponse,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
// eslint-disable-next-line import-x/named
import { connect, type MqttClient } from 'mqtt';
import { type BambuLanCredentials, PUSH_ALL } from './shared/mqttClient';
import { summarizeStatus } from './shared/summarize';
import {
	extractGcodeState,
	checkFieldChanges,
	mergeOutput,
	buildWatchedFields,
} from './shared/filter';

const REPORT_TOPIC = (serial: string) => `device/${serial}/report`;
const REQUEST_TOPIC = (serial: string) => `device/${serial}/request`;

export class BambuLabTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bambu Lab Printer Trigger',
		name: 'bambuLabTrigger',
		icon: 'file:bambulab.svg',
		group: ['trigger'],
		version: 1,
		usableAsTool: true,
		subtitle: 'printer event',
		description:
			'Polls a Bambu Lab printer via local MQTT and emits an event whenever the printer status changes',
		defaults: { name: 'Bambu Lab Printer Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'bambuLabLanApi', required: true, testedBy: 'bambuLab' }],
		triggerPanel: {
			header: '',
			executionsHelp: {
				inactive:
					"Click 'Test step' to connect and capture the current printer state as a snapshot.",
				active:
					'Workflow is active. The node maintains a persistent MQTT connection and emits an event whenever a watched field changes.',
			},
			activationHint:
				'Activate the workflow to start listening. In <b>Any Field Change</b> mode the node emits one snapshot on startup, then fires again whenever a watched field crosses its threshold.',
		},
		properties: [
			{
				displayName: 'Poll Interval (Seconds)',
				name: 'pollInterval',
				type: 'number',
				default: 30,
				description: 'How often to request a fresh status from the printer',
			},
			{
				displayName: 'Response Mode',
				name: 'responseMode',
				type: 'options',
				options: [
					{ name: 'Summary', value: 'summary', description: 'Normalized status fields' },
					{ name: 'Raw', value: 'raw', description: 'Full raw printer payload' },
				],
				default: 'summary',
			},
			{
				displayName: 'Filter Mode',
				name: 'filterMode',
				type: 'options',
				options: [
					{
						name: 'Any Field Change',
						value: 'anyChange',
						description: 'Fire whenever any status field changes (e.g. lights, temps, state)',
					},
					{
						name: 'Printer State Only',
						value: 'stateChange',
						description: 'Fire only when the printer state changes (e.g. IDLE → RUNNING)',
					},
					{
						name: 'Every Message',
						value: 'off',
						description: 'Fire on every MQTT message received',
					},
				],
				default: 'anyChange',
				description: 'When to emit an event',
			},
			{
				displayName: 'Layer Change Threshold',
				name: 'layerThreshold',
				type: 'number',
				default: 1,
				description: 'Minimum number of layers between events',
				displayOptions: { show: { filterMode: ['anyChange'] } },
			},
			{
				displayName: 'Progress Threshold (%)',
				name: 'progressThreshold',
				type: 'number',
				default: 5,
				description: 'Minimum percentage change in progress before firing an event',
				displayOptions: { show: { filterMode: ['anyChange'] } },
			},
			{
				displayName: 'Temperature Threshold (°C)',
				name: 'tempThreshold',
				type: 'number',
				default: 2,
				description:
					'Minimum °C change in actual temperatures (nozzle, bed, chamber) before firing an event',
				displayOptions: { show: { filterMode: ['anyChange'] } },
			},
			{
				displayName: 'Target Temperature Threshold (°C)',
				name: 'targetTempThreshold',
				type: 'number',
				default: 1,
				description: 'Minimum °C change in target temperatures before firing an event',
				displayOptions: { show: { filterMode: ['anyChange'] } },
			},
			{
				displayName: 'Trigger On Fields',
				name: 'triggerFields',
				type: 'multiOptions',
				options: [
					{ name: 'Printer State (IDLE / RUNNING / PAUSE…)', value: 'state' },
					{ name: 'Print Stage (bed leveling, nozzle clean…)', value: 'stage' },
					{ name: 'Print Type', value: 'print_type' },
					{ name: 'Task Name', value: 'task_name' },
					{ name: 'Project ID', value: 'project_id' },
					{ name: 'Progress (%)', value: 'progress_pct' },
					{ name: 'Current Layer', value: 'current_layer' },
					{ name: 'Nozzle Temperature', value: 'nozzle_temp_c' },
					{ name: 'Bed Temperature', value: 'bed_temp_c' },
					{ name: 'Chamber Temperature', value: 'chamber_temp_c' },
					{ name: 'Nozzle Target Temperature', value: 'nozzle_target_c' },
					{ name: 'Bed Target Temperature', value: 'bed_target_c' },
					{ name: 'Error Code', value: 'error_code' },
					{ name: 'Speed Level', value: 'speed_level' },
				],
				default: [
					'state',
					'stage',
					'error_code',
					'current_layer',
					'progress_pct',
					'nozzle_temp_c',
					'bed_temp_c',
					'nozzle_target_c',
					'bed_target_c',
				],
				description:
					'Which fields can trigger an event. All fields remain in the output regardless of this selection.',
				displayOptions: { show: { filterMode: ['anyChange'] } },
			},
		],
	};

	async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
		const rawCredentials = await this.getCredentials('bambuLabLanApi');
		const credentials: BambuLanCredentials = {
			host: rawCredentials.host as string,
			serial: (rawCredentials.serial as string).toUpperCase(),
			accessCode: rawCredentials.accessCode as string,
		};

		const pollIntervalSec = this.getNodeParameter('pollInterval') as number;
		const responseMode = this.getNodeParameter('responseMode') as string;
		const filterMode = this.getNodeParameter('filterMode') as string;
		const layerThreshold = this.getNodeParameter('layerThreshold', 1) as number;
		const progressThreshold = this.getNodeParameter('progressThreshold', 5) as number;
		const tempThreshold = this.getNodeParameter('tempThreshold', 2) as number;
		const targetTempThreshold = this.getNodeParameter('targetTempThreshold', 1) as number;
		const triggerFields = this.getNodeParameter('triggerFields', [
			'state',
			'stage',
			'error_code',
			'current_layer',
			'progress_pct',
			'nozzle_temp_c',
			'bed_temp_c',
			'nozzle_target_c',
			'bed_target_c',
		]) as string[];

		if (pollIntervalSec < 5) {
			throw new NodeOperationError(this.getNode(), 'Poll interval must be at least 5 seconds');
		}

		const reportTopic = REPORT_TOPIC(credentials.serial);
		const requestTopic = REQUEST_TOPIC(credentials.serial);

		// Persist last gcode_state across restarts so stateChange mode doesn't re-fire on reconnect.
		// lastValues is intentionally NOT persisted — anyChange mode should always emit a
		// full snapshot on startup so the workflow has a current baseline to work from.
		const staticData = this.getWorkflowStaticData('node') as {
			lastState?: string;
		};

		// In-memory only: resets each time the trigger activates
		let lastValues: Record<string, unknown> = {};
		let accumulatedOutput: Record<string, unknown> = {};
		const watchedFields = buildWatchedFields(
			{ layerThreshold, progressThreshold, tempThreshold, targetTempThreshold },
			triggerFields,
		);

		let pollTimer: ReturnType<typeof setInterval> | undefined;

		const createMqttClient = (): Promise<MqttClient> =>
			new Promise((resolve, reject) => {
				const client: MqttClient = connect(`mqtts://${credentials.host}:8883`, {
					username: 'bblp',
					password: credentials.accessCode,
					clientId: `n8n-bambulab-trigger-${Date.now()}`,
					clean: true,
					connectTimeout: 10_000,
					rejectUnauthorized: false,
				});

				client.once('connect', () => resolve(client));
				client.once('error', (err) => reject(err));
			});

		const handleMessage = (payload: Buffer) => {
			let parsed: IDataObject;
			try {
				parsed = JSON.parse(payload.toString()) as IDataObject;
			} catch {
				return;
			}

			// Skip empty ack frames
			if (Object.keys(parsed).length === 0) return;

			const output = responseMode === 'raw' ? parsed : summarizeStatus(parsed);

			if (filterMode === 'stateChange') {
				const currentState = extractGcodeState(parsed as Record<string, unknown>);
				if (currentState === null) return;
				if (currentState === staticData.lastState) return;
				staticData.lastState = currentState;
			} else if (filterMode === 'anyChange') {
				const print = ((parsed.print as Record<string, unknown> | undefined) ?? parsed) as Record<
					string,
					unknown
				>;
				const { changed, nextValues } = checkFieldChanges(print, lastValues, watchedFields);
				lastValues = nextValues;
				if (changed.length === 0) return;
				// Merge partial frame into accumulated snapshot so emitted output is always complete
				if (responseMode === 'summary') {
					accumulatedOutput = mergeOutput(
						output as Record<string, unknown>,
						accumulatedOutput,
						print,
					);
				}

				const triggeredBy = Object.fromEntries(
					changed.map(({ key, from, to }) => [key, { from, to }]),
				);
				const emitOutput =
					responseMode === 'summary'
						? ({ ...accumulatedOutput, triggered_by: triggeredBy } as IDataObject)
						: ({ ...output, triggered_by: triggeredBy } as IDataObject);
				this.emit([this.helpers.returnJsonArray([emitOutput])]);
				return;
			}
		};

		// ── Manual (test) mode: connect, send one PUSH_ALL, wait for one reply ──
		const manualTriggerFunction = async () => {
			const client = await createMqttClient();
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					client.end(true);
					reject(new NodeOperationError(this.getNode(), 'Timed out waiting for printer response'));
				}, 15_000);

				client.once('message', (_topic, payload) => {
					clearTimeout(timeout);
					client.end(true);
					handleMessage(payload);
					resolve();
				});

				client.subscribe(reportTopic, (err) => {
					if (err) {
						clearTimeout(timeout);
						client.end(true);
						reject(err);
						return;
					}
					client.publish(requestTopic, JSON.stringify(PUSH_ALL));
				});
			});
		};

		// ── Active (background) mode: persistent connection + interval polling ──
		let activeClient: MqttClient | undefined;

		if (this.getMode() === 'trigger') {
			activeClient = await createMqttClient();

			activeClient.on('message', (_topic, payload) => {
				handleMessage(payload);
			});

			activeClient.subscribe(reportTopic);

			// Send first request immediately, then on interval
			const sendPoll = () => {
				if (activeClient?.connected) {
					activeClient.publish(requestTopic, JSON.stringify(PUSH_ALL));
				}
			};

			sendPoll();
			pollTimer = setInterval(sendPoll, pollIntervalSec * 1000);
		}

		const closeFunction = async () => {
			if (pollTimer) clearInterval(pollTimer);
			if (activeClient) await activeClient.endAsync().catch(() => {});
		};

		return { closeFunction, manualTriggerFunction };
	}
}
