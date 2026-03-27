import type {
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { mqttRequest, PUSH_ALL, type BambuLanCredentials } from './shared/mqttClient';

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
			const timeoutMs = this.getNodeParameter('timeoutMs', i) as number;
			const rawCredentials = await this.getCredentials('bambuLabLanApi');

			const credentials: BambuLanCredentials = {
				host: rawCredentials.host as string,
				serial: (rawCredentials.serial as string).toUpperCase(),
				accessCode: rawCredentials.accessCode as string,
			};

			try {
				let command: object;

				if (operation === 'getStatus') {
					command = PUSH_ALL;
				} else if (operation === 'sendCommand') {
					const raw = this.getNodeParameter('command', i) as string | object;
					command = typeof raw === 'string' ? (JSON.parse(raw) as object) : raw;
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown operation: ${operation}`);
				}

				const response = await mqttRequest(credentials, command, timeoutMs);
				returnData.push({
					json: response as IDataObject,
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
