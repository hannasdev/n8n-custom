import { connect, type MqttClient } from 'mqtt';

const REPORT_TOPIC = (serial: string) => `device/${serial}/report`;
const REQUEST_TOPIC = (serial: string) => `device/${serial}/request`;

export const PUSH_ALL = {
	pushing: { sequence_id: '0', command: 'pushall', version: 1, push_target: 1 },
};

export interface BambuLanCredentials {
	host: string;
	serial: string;
	accessCode: string;
}

/**
 * Opens a short-lived MQTT connection to a Bambu printer, publishes `command`
 * to the request topic, and resolves with the first message received on the
 * report topic. Disconnects and cleans up on success, error, or timeout.
 *
 * TLS certificate verification is disabled because Bambu printers use a custom
 * CA that is not publicly trusted. The connection is still fully TLS-encrypted.
 */
export async function mqttRequest(
	credentials: BambuLanCredentials,
	command: object,
	timeoutMs = 10_000,
): Promise<object> {
	const { host, serial, accessCode } = credentials;

	return new Promise((resolve, reject) => {
		let settled = false;

		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			client.end(true);
			fn();
		};

		const client: MqttClient = connect(`mqtts://${host}:8883`, {
			username: 'bblp',
			password: accessCode,
			clientId: `n8n-bambulab-${Date.now()}`,
			clean: true,
			connectTimeout: 5_000,
			// Bambu printers use a custom CA; disable cert verification for local LAN use.
			rejectUnauthorized: false,
		});

		const timer = setTimeout(() => {
			settle(() => reject(new Error('Timed out waiting for printer response')));
		}, timeoutMs);

		client.once('connect', () => {
			client.subscribe(REPORT_TOPIC(serial), (err) => {
				if (err) {
					settle(() => reject(err));
					return;
				}
				client.publish(REQUEST_TOPIC(serial), JSON.stringify(command));
			});
		});

		client.on('message', (_topic, payload) => {
			let parsed: object;

			try {
				parsed = JSON.parse(payload.toString()) as object;
			} catch {
				settle(() => reject(new Error('Printer returned non-JSON payload')));
				return;
			}

			// Bambu printers can emit an empty acknowledgement frame before the actual report.
			if (Object.keys(parsed).length === 0) {
				return;
			}

			settle(() => resolve(parsed));
		});

		client.once('error', (err) => {
			settle(() => reject(err));
		});
	});
}
