# Changelog

All notable changes to this project will be documented in this file.

## [0.1.0] - 2026-03-28

### Added

- `Bambu Lab Printer` action node with operation: Get Status
- `Bambu Lab Printer Trigger` node: persistent local MQTT polling with configurable interval
- Summary and raw response modes for both nodes
- "Fire Only on State Change" option on trigger node — suppresses repeat events when printer state is unchanged
- `Bambu Lab (Local Network)` credential type (host, serial, access code)
