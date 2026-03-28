import type { ICredentialType, INodeProperties } from 'n8n-workflow';

export class BambuLabLanApi implements ICredentialType {
	name = 'bambuLabLanApi';

	displayName = 'Bambu Lab (Local Network) API';

	documentationUrl = 'https://github.com/hannasdev/n8n-nodes-bambulab';

	icon = 'file:bambulab.svg' as const;

	testedBy = 'bambuLab';

	properties: INodeProperties[] = [
		{
			displayName: 'Printer IP Address',
			name: 'host',
			type: 'string',
			default: '',
			placeholder: '192.168.1.100',
			description: 'Local IP address of the printer — find it in the printer network settings.',
		},
		{
			displayName: 'Printer Serial Number',
			name: 'serial',
			type: 'string',
			default: '',
			placeholder: 'A1B2C3D4E5F6A1B2',
			description:
				'Serial number from the printer settings (the long alphanumeric ID, not the model name). Must be uppercase.',
		},
		{
			displayName: 'Access Code',
			name: 'accessCode',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			description: 'Access code from the printer LAN settings (typically 8 characters).',
		},
	];
}
