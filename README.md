# n8n-nodes-bambulab

This is an n8n community node package for controlling and monitoring Bambu Lab printers over the local network.

Bambu Lab is a 3D printer platform. This package communicates with the printer directly via local MQTT (no Bambu Cloud required).

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and search for `n8n-nodes-bambulab`.

For local development with the included Docker setup:

```bash
npm install
npm run build
docker compose up -d

# After code changes:
npm run build
docker compose restart n8n
```

n8n is available at http://localhost:5678.

## Operations

### Node: Bambu Lab Printer

An action node for on-demand operations.

| Operation    | Description                                 |
| ------------ | ------------------------------------------- |
| Get Status   | Request a full status push from the printer |
| Pause Print  | Pause the current print                     |
| Resume Print | Resume a paused print                       |
| Cancel Print | Stop the current print                      |
| Send Command | Publish a raw JSON command to the printer   |

**Response mode** (Get Status):

- **Summary** — Normalized status object with named fields (temperatures, progress, state, etc.)
- **Raw** — Full raw MQTT payload from the printer

### Node: Bambu Lab Printer Trigger

A trigger node for event-driven workflows. Maintains a persistent MQTT connection and polls the printer on an interval.

| Parameter                 | Description                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------ |
| Poll Interval (seconds)   | How often to request fresh status (minimum 5s, default 30s)                          |
| Response Mode             | Summary or Raw (same as above)                                                       |
| Fire Only on State Change | When enabled, only emits when `gcode_state` changes (e.g. `IDLE → RUNNING → FINISH`) |

**Tip:** Enable "Fire Only on State Change" to build notification workflows that fire on print complete, print error, etc. without spamming on every poll.

## Credentials

Credential type: **Bambu Lab (Local Network)**

| Field                 | Description                                        |
| --------------------- | -------------------------------------------------- |
| Printer IP Address    | Local IP of the printer                            |
| Printer Serial Number | Uppercase alphanumeric serial (e.g. `01P00C5A...`) |
| Access Code           | 8-character access code                            |

Where to find these on the printer touchscreen:

- **Settings > Network / WLAN** — IP address and Access Code
- **Settings > Device** — Serial number

**Security notes:**

- Credentials are stored encrypted by n8n and never written into workflow JSON as plaintext.
- MQTT traffic is TLS-encrypted on port 8883.
- Certificate verification is disabled for local printer TLS (Bambu printers use a private CA).
- Do not expose printer network endpoints to the public internet.

## Compatibility

- Minimum tested n8n version: **2.13.4**
- Tested on: Docker image `n8nio/n8n:2.13.4`
- Tested printers: Bambu Lab X1C, P1S (reports from community welcome)

Known behavior:

- Imported workflows require credentials to be re-selected once in the UI to bind local credential IDs.
- The Bambu MQTT broker is point-to-point — report messages are only delivered to the requesting client, not broadcast. This is why the trigger node sends its own PUSH_ALL request rather than passively subscribing.

## Usage

### Example: Print complete notification

1. Add a **Bambu Lab Printer Trigger** node
2. Enable **Fire Only on State Change**
3. Connect an **IF** node: condition `state` equals `FINISH`
4. Connect a **Telegram** (or other) node to send a notification

### Included workflow templates

- `workflows/bambulab-showcase.workflow.json` — manual status check and raw command example

Import:

```bash
docker compose exec n8n n8n import:workflow \
  --input=/custom-extensions/my-custom-node/workflows/bambulab-showcase.workflow.json
```

After importing, open the workflow in n8n and re-select your **Bambu Lab Local** credential on each node.

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/#community-nodes)
- [Bambu Lab](https://bambulab.com)
- [ha-bambulab](https://github.com/greghesp/ha-bambulab) — acknowledged reference for MQTT topic/payload structure

## Version history

### 0.1.0

- Initial release
- `Bambu Lab Printer` action node: get status, pause, resume, cancel, send raw command
- `Bambu Lab Printer Trigger` node: persistent MQTT polling, state-change filtering
- Summary and raw response modes
- Local network credential type (host, serial, access code)
