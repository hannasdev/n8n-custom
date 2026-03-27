# n8n-nodes-bambulab

This is an n8n community node package for controlling and monitoring Bambu Lab printers over the local network.

Bambu Lab is a 3D printer platform. This node currently focuses on direct local MQTT communication for status and print control actions.

[Installation](#installation)
[Operations](#operations)
[Credentials](#credentials)
[Compatibility](#compatibility)
[Usage](#usage)
[Resources](#resources)
[Version history](#version-history)

## Installation

If you are using this as a published community node package, follow the n8n community nodes installation guide:

- https://docs.n8n.io/integrations/community-nodes/installation/

For local development with the included Docker setup in this repository:

1. Build the package

npm install
npm run build

2. Start n8n

docker compose up -d

3. Rebuild and reload when code changes

npm run build
docker compose restart n8n

n8n is available at http://localhost:5678.

## Operations

Node: Bambu Lab Printer

- Get Status: Request a full status push from the printer
- Pause Print: Pause the current print
- Resume Print: Resume a paused print
- Cancel Print: Stop the current print
- Send Command: Publish a raw JSON command to the printer

Response mode:

- Summary: Return a normalized status object
- Raw: Return the raw MQTT payload from the printer

## Credentials

Credential type: Bambu Lab (Local Network)

Required fields:

- Printer IP Address
- Printer Serial Number (uppercase alphanumeric printer serial)
- Access Code

Where to find values on the printer touchscreen:

- Settings > Network / WLAN: IP address and Access Code
- Settings > Device: Serial number

Recommended credential name for the included showcase workflow: Bambu Lab Local

Security notes:

- Credentials are stored encrypted by n8n and not written into workflow JSON as plaintext secrets.
- MQTT traffic is TLS-encrypted on port 8883.
- This implementation disables certificate verification for local printer TLS because Bambu printers use a private CA.
- Do not expose printer network endpoints to the public internet.

## Compatibility

- Minimum tested n8n version: 2.13.4
- Tested runtime in this repository: Docker image n8nio/n8n:2.13.4

Known behavior:

- Imported workflows should have credentials re-selected once in the UI to bind local credential IDs.
- Custom extension nodes in this setup use the CUSTOM node type prefix internally.

## Usage

Showcase workflow file:

- workflows/bambulab-showcase.workflow.json

Import with CLI:

docker compose exec n8n n8n import:workflow --input=/custom-extensions/my-custom-node/workflows/bambulab-showcase.workflow.json

After importing:

1. Open the workflow in n8n
2. Open each Bambu Lab node and select your Bambu Lab Local credential
3. Save the workflow
4. Run manually

Tip:

- Manual Trigger output can appear as an empty item before downstream nodes run. The meaningful payload comes from the Bambu node output.

## Resources

- n8n community nodes docs: https://docs.n8n.io/integrations/#community-nodes
- Bambu Lab: https://bambulab.com
- Home Assistant Bambu Lab integration (acknowledged reference): https://github.com/greghesp/ha-bambulab

## Version history

- 0.1.0
  - Local Bambu Lab credential type
  - Local MQTT node operations: get status, pause, resume, cancel, send raw command
  - Response modes: summary and raw
  - Included showcase workflow
