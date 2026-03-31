# n8n-nodes-bambulab

This is an n8n community node package for controlling and monitoring Bambu Lab printers over the local network.

Bambu Lab is a 3D printer platform. This package communicates with the printer directly via local MQTT (no Bambu Cloud required).

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)

## Installation

Follow the [n8n community nodes installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) and search for `@hanna84/n8n-nodes-bambulab`.

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

| Operation  | Description                                 |
| ---------- | ------------------------------------------- |
| Get Status | Request a full status push from the printer |

**Response mode** (Get Status):

- **Summary** — Normalized status object with named fields (temperatures, progress, state, etc.)
- **Raw** — Full raw MQTT payload from the printer

### Node: Bambu Lab Printer Trigger

A trigger node for event-driven workflows. Maintains a persistent MQTT connection and polls the printer on a configurable interval.

| Parameter               | Description                                                                  |
| ----------------------- | ---------------------------------------------------------------------------- |
| Poll Interval (seconds) | How often to request fresh status from the printer (minimum 5s, default 30s) |
| Response Mode           | **Summary** — normalized fields. **Raw** — full MQTT payload                 |
| Filter Mode             | Controls when events are emitted (see below)                                 |

**Filter modes:**

| Mode                             | Behaviour                                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Any Field Change** _(default)_ | Emits a full snapshot on startup, then fires again whenever a watched field crosses its threshold |
| **Printer State Only**           | Fires only when `gcode_state` changes (e.g. `IDLE → RUNNING → FINISH`)                            |
| **Every Message**                | Fires on every MQTT message received — use with care                                              |

**Any Field Change options** (shown when that mode is selected):

| Parameter                  | Default                                     | Description                                                                                 |
| -------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Trigger On Fields          | State, Stage, Layer, Progress, Temps, Error | Checklist of which fields can trigger an event. All fields appear in the output regardless. |
| Layer Change Threshold     | 1                                           | Minimum layers between events                                                               |
| Progress Threshold (%)     | 5                                           | Minimum % progress change between events                                                    |
| Temperature Threshold (°C) | 2                                           | Minimum °C change for actual temps (nozzle, bed, chamber)                                   |
| Target Temp Threshold (°C) | 1                                           | Minimum °C change for target temperatures                                                   |

**Output fields** (in Summary mode) include: `state`, `stage`, `progress_pct`, `current_layer`, `total_layers`, `nozzle_temp_c`, `bed_temp_c`, `nozzle_target_c`, `bed_target_c`, `chamber_temp_c`, `task_name`, `error_code`, `speed_level`, `chamber_light`, `wifi_signal`, `received_at`, and more.

In **Any Field Change** mode the output also includes a `triggered_by` object showing which fields changed and their before/after values — useful for debugging unexpected events:

```json
"triggered_by": {
  "current_layer": { "from": 20, "to": 25 },
  "progress_pct": { "from": 23, "to": 28 }
}
```

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
- Bambu printers allow only one MQTT client at a time. If another device connects to the printer while the trigger node is running, the node will be disconnected. It reconnects automatically within a few seconds and resumes polling, but any events that occurred during the reconnect window will be missed.

## Usage

### Example: Print complete notification

1. Add a **Bambu Lab Printer Trigger** node
2. Set **Filter Mode** to **Printer State Only**
3. Connect an **IF** node: condition `state` equals `FINISH`
4. Connect a **Telegram** (or other) node to send a notification

### Example: Layer progress updates

1. Add a **Bambu Lab Printer Trigger** node
2. Leave **Filter Mode** as **Any Field Change**
3. Set **Layer Change Threshold** to `10` (fires every 10 layers)
4. Uncheck all **Trigger On Fields** except **Current Layer**
5. Use `current_layer` and `total_layers` in your downstream nodes

### Example: Debugging unexpected events

If the trigger fires more often than expected, check the `triggered_by` field in the output — it shows exactly which field crossed its threshold (e.g. `{ "progress_pct": { "from": 23, "to": 28 } }`). Uncheck that field in **Trigger On Fields** or raise its threshold.

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

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the full release history.
