# Changelog

## Unreleased

- Add `tps.primaryMetric` configuration with `decode`, `generation`, and `wall` options.
- Persist all three TPS measurements while using the configured metric for the primary `tps` field and notification.
- Clarify decode fallback behavior and the shared maximum-plausible-TPS sanity gate in the documentation.
- Define wall TPS from the first non-empty text delta to the assistant message end, excluding TTFT and post-output tool handling.
- Make wall TPS the default primary metric and suppress primary TPS for turns that contain no visible assistant text.

## 1.3.15

- Pin development SDKs to Pi 1.0.0 while retaining host-owned wildcard peers.
- Exercise actual SDK and bundled host lifecycle, identity, native nested validation/loadouts, reload and shutdown offline.
- Verify persisted telemetry for each actual fake-provider turn.

## 1.3.14

- Validate against Pi 0.99.0, including an offline real-host package-loading probe.
- Declare imported host packages as wildcard peers and pin development dependencies to Pi 0.99.0.
