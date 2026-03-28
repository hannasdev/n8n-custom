import type {
	INodeCredentialTestResult,
	ICredentialTestFunctions,
	ICredentialsDecrypted,
	IDataObject,
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';
import {
	mqttRequest,
	PUSH_ALL,
	type BambuLanCredentials,
	testMqttConnection,
} from './shared/mqttClient';
import { summarizeStatus } from './shared/summarize';

export class BambuLab implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'Bambu Lab Printer',
		name: 'bambuLab',
		icon: 'file:bambulab.svg',
		group: ['output'],
		version: 1,
		usableAsTool: true,
		subtitle: 'get status',
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
				testedBy: 'bambuLab',
			},
		],
		properties: [
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
				displayName: 'Include Raw Payload in Summary',
				name: 'includeRawPayload',
				type: 'boolean',
				default: false,
				description:
					'Whether to include the full raw printer payload in summary mode for debugging and field discovery',
				displayOptions: {
					show: {
						responseMode: ['summary'],
					},
				},
			},
			{
				displayName: 'Timeout (Ms)',
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
			const responseMode = this.getNodeParameter('responseMode', i) as string;
			const includeRawPayload = this.getNodeParameter('includeRawPayload', i) as boolean;
			const timeoutMs = this.getNodeParameter('timeoutMs', i) as number;
			const rawCredentials = await this.getCredentials('bambuLabLanApi');

			const credentials: BambuLanCredentials = {
				host: rawCredentials.host as string,
				serial: (rawCredentials.serial as string).toUpperCase(),
				accessCode: rawCredentials.accessCode as string,
			};

			try {
				const response = await mqttRequest(credentials, PUSH_ALL, timeoutMs);
				const output =
					responseMode === 'raw'
						? (response as IDataObject)
						: summarizeStatus(response as IDataObject);

				if (responseMode === 'summary' && includeRawPayload) {
					(output as IDataObject).raw_payload = response as IDataObject;
				}

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

	async credentialTest(
		this: ICredentialTestFunctions,
		credential: ICredentialsDecrypted,
	): Promise<INodeCredentialTestResult> {
		const credentials = credential.data as unknown as BambuLanCredentials;
		try {
			await testMqttConnection(credentials);
			return { status: 'OK', message: 'Connected to printer successfully' };
		} catch (error) {
			return { status: 'Error', message: (error as Error).message };
		}
	}
}
