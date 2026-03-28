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
					"Click 'Test step' to listen for one printer event, then activate the workflow to keep polling continuously.",
				active:
					'Workflow is active. The node polls the printer every <b>Poll Interval</b> seconds and fires when the printer responds.',
			},
			activationHint:
				'Publish the workflow to start continuous polling. The node fires on each printer response.',
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
				displayName: 'Fire Only on State Change',
				name: 'stateChangeOnly',
				type: 'boolean',
				default: true,
				description:
					'Whether to emit an event only when the printer state (e.g. RUNNING → FINISH) changes between polls',
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
		const stateChangeOnly = this.getNodeParameter('stateChangeOnly') as boolean;

		if (pollIntervalSec < 5) {
			throw new NodeOperationError(this.getNode(), 'Poll interval must be at least 5 seconds');
		}

		const reportTopic = REPORT_TOPIC(credentials.serial);
		const requestTopic = REQUEST_TOPIC(credentials.serial);

		// Persist lastState across restarts so publish/restart doesn't re-fire stale states
		const staticData = this.getWorkflowStaticData('node') as { lastState?: string };

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

			if (stateChangeOnly) {
				const rawState =
					(parsed.print as IDataObject | undefined)?.gcode_state ?? parsed.gcode_state;
				// Skip partial frames that don't carry gcode_state at all
				if (rawState === undefined || rawState === null || rawState === '') return;
				const currentState = String(rawState);
				if (currentState === staticData.lastState) return;
				staticData.lastState = currentState;
			}

			this.emit([this.helpers.returnJsonArray([output])]);
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
