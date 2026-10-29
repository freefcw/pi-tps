<div align="center">

# 📊 pi-tps

**Tokens-per-second tracker for [pi](https://github.com/earendil-works/pi-coding-agent)**

_Generation speed, TTFT, stall detection, and cost — after every agent turn._

[![pi extension](https://img.shields.io/badge/pi-extension-blueviolet)](https://github.com/earendil-works/pi-coding-agent)
[![license](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

</div>

## Pi 1.0 compatibility (1.3.15)

Development SDKs are pinned to **1.0.0**; host-provided dependencies remain wildcard peers. Run `bun run test:pi` for offline real-host registrations, prompt/tool loadouts, nested calls, reload and shutdown. Set `PI1_HOST_PACKAGE` to an installed Pi package directory and `PI1_HOST_ENTRY=bundle` to check its bundled runtime.

---

_Originally from [badlogic/pi-mono](https://github.com/badlogic/pi-mono/blob/main/.pi/extensions/tps.ts). Packaged as an installable pi extension._

---

## Quick start

```bash
pi install npm:@monotykamary/pi-tps
```

## What's included

|               |                                                                        |
| ------------- | ---------------------------------------------------------------------- |
| **Extension** | Tracks TPS, TTFT, stall time, token usage, and cost after each turn    |
| **Export**    | `/tps-export` command — dump telemetry as JSONL with session structure |

### Features

- **Configurable primary metric**: Choose decode speed, assistant-generation speed, or output-window TPS in Pi settings
- **Accurate decode TPS**: Uses `performance.now()` sub-millisecond timing; excludes TTFT, tool-execution gaps, and network latency from generation speed
- **Stall detection**: Detects inference pauses (GPU queuing, request queuing) and subtracts them from generation TPS — no inflated rates
- **Burst discrimination**: Distinguishes genuine streaming from buffer-flush dispatch; shows `—` when the rate is structurally unidentifiable
- **Multi-message turns**: Aggregates tokens and timing across tool-call chains within one turn
- **Notification banner**: Shows a transient popup with TPS, TTFT, total time, tokens, and stalls
- **Persisted notifications**: Restored on session resume and `/tree` navigation (structured + legacy backward compatible)
- **Export command**: Dump telemetry as JSONL with automatic tree re-chaining for web inspectors
- **Extensible**: Emits `tps:telemetry` events so other extensions can react to telemetry

## Install

```bash
pi install npm:@monotykamary/pi-tps
```

Or install from GitHub:

```bash
pi install https://github.com/monotykamary/pi-tps
```

The published npm package is intentionally slim: only `extensions/pi-tps/index.ts`, `README.md`, and `LICENSE`. It has **no runtime `dependencies`** and does **not** ship `npm-shrinkwrap.json` / lockfiles, so installs do not pull the multi-hundred-MB developer toolchain into `~/.pi/agent/npm`.

<details>
<summary>Manual install</summary>

```bash
cp -r extensions/pi-tps ~/.pi/agent/extensions/
```

Then `/reload` in pi.

</details>

---

## Output format

```
TPS 42.5 tok/s · TTFT 1.2s · 29.7s · in 567 · out 1.2K · stall 4.3s×1 · $3.60/M
```

| Field   | Description                                                                                                         |
| ------- | ------------------------------------------------------------------------------------------------------------------- |
| `TPS`   | The configured primary metric; defaults to output-window TPS from first visible text delta to assistant message end |
| `TTFT`  | Time to first token (seconds, 1 decimal)                                                                            |
| `s`     | Total wall-clock time from request to completion                                                                    |
| `in`    | Input tokens (human-readable: K/M/B)                                                                                |
| `out`   | Output tokens (human-readable: K/M/B)                                                                               |
| `stall` | Accumulated stall time × stall count (shown only when stalls exist)                                                 |
| `$/M`   | Blended $/million-tokens rate for this turn (shown only when a cost source is available)                            |

When TPS can't be determined (burst delivery, too few chunks), the field shows `—`:

```
TPS — · TTFT 0.8s · 1.3s · in 291 · out 46 · $2.59/M
```

### Primary TPS metric configuration

Set `tps.primaryMetric` in `~/.pi/agent/settings.json` or the project `.pi/settings.json`:

```json
{
  "tps": {
    "primaryMetric": "wall"
  }
}
```

Available values:

| Value        | Meaning                                                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `decode`     | Uses reliable inter-update decode speed when available; otherwise falls back to a conservative generation-window calculation that may include TTFT. Known stalls are handled by the existing stall guards and reduction rules.                                                    |
| `generation` | Output tokens divided by complete assistant-generation time; includes TTFT and pauses inside assistant messages, but excludes gaps between assistant messages.                                                                                                                    |
| `wall`       | Output tokens divided by the interval from the first non-empty text delta (first visible character) to the assistant `message_end`. It excludes TTFT and post-output tool handling. Turns with no visible text do not expose this as the primary TPS. This is the default metric. |

The persisted `tps` field and notification use the selected metric. Each telemetry entry also keeps all three values in `decodeTps`, `generationTps`, and `wallTps`, so changing the setting does not discard the other measurements. The setting is read at the end of each turn, so changes apply from the next turn. Invalid or missing values fall back to `wall`. All three metrics are subject to the same maximum-plausible-TPS sanity gate; values above the gate are reported as `null` and displayed as `—`.

Each Pi turn corresponds to one model request. If the assistant calls tools, Pi ends the turn after tool execution and starts the next model request with a new `turn_start`. Therefore `wallTps` measures one request from its first visible text delta to its assistant `message_end`; it intentionally excludes tool execution after that message. If a full user request spanning several model/tool turns is needed, that should be calculated separately over the `agent_start` → `agent_settled` lifecycle.

### $/M-tokens rate

The trailing `$/M` segment is a blended per-turn rate: `effectiveCost / (totalTokens / 1_000_000)`, shown to two decimals. Only one cost source contributes per turn (no double-counting):

- When [pi-neuralwatt-provider](https://github.com/monotykamary/pi-neuralwatt-provider) reports the **energy-billed cost** for the turn (what you're actually invoiced), that wins outright.
- Otherwise the **list-price compute cost** from `message.usage.cost.total` (derived from the model's pricing table via pi-ai) is used.
- When neither is available (no pricing, zero tokens), the segment is omitted.

The cross-extension handoff is event-based: pi-neuralwatt-provider emits `neuralwatt:turn-energy` with `{ costUsd, energyJoules, turnIndex }` in its own `turn_end`; pi-tps subscribes at load and stashes `costUsd` keyed by `turnIndex`. pi dispatches `turn_end` handlers sequentially, so if the neuralwatt provider was registered before pi-tps the value is already cached when pi-tps's `turn_end` runs; if not, pi-tps falls back to the list-price rate for that one turn (the neuralwatt widget still shows billing separately). No latency is added — pi-tps reads the cache synchronously, never awaits.

Human-readable scaling (for token counts):

- `< 1K`: raw integer (`567`)
- `≥ 1K`: one decimal, drops `.0` (`1.2K`, `2K`, `15.3K`)
- `≥ 1M`: same pattern (`1.5M`)
- `≥ 1B`: same pattern (`1.2B`)

Duration formatting:

- `< 60s`: one decimal (`2.3s`, `45.0s`)
- `≥ 60s`: up to two units with no decimals (`1m 30s`, `2h 15m`, `3d 12h`, `1w 3d`, `1mo 0d`, `1y 0d`)

---

## How it works

The extension hooks into pi's lifecycle events. The critical detail: `message_start` fires at stream creation, and Pi also emits `message_update` for content-block start/end events. **TTFT and the wall-TPS window start at the first non-empty content delta**; for user-facing wall TPS this is the first non-empty `text_delta`.

### Event sequence

```
turn_start         →  request sent to LLM, timer starts
message_start      →  stream created, stall-tracking reset for this message
message_update       →  content-block start/end events (not timing anchors)
message_update       →  first non-empty delta arrives → TTFT captured
message_update (N)   →  streaming deltas arrive → inter-update span & stall detection
message_end        →  message complete, generation time accumulated
turn_end           →  telemetry computed and displayed
```

### Timing breakdown

| Phase             | Measured by                                                                                  |
| ----------------- | -------------------------------------------------------------------------------------------- |
| **TTFT**          | `turn_start` → first non-empty content delta                                                 |
| **Generation**    | per-message wall clock (`message_start` → `message_end`), summed across messages in the turn |
| **Stream span**   | first content delta (post-TTFT) → last `message_update` — the pure streaming window          |
| **Total**         | `turn_start` → `turn_end`                                                                    |
| **Output window** | first non-empty `text_delta` → assistant `message_end`                                       |

This approach excludes:

- **Network latency** (included in TTFT)
- **Post-output tool execution** (the request ends at assistant `message_end`)
- **Server queue time** (included in TTFT)

### Stall detection

Every `message_update` (after TTFT) measures the gap since the last update. Gaps ≥ 500ms are classified as inference stalls:

- The full gap is accumulated as `stallMs`
- Consecutive stalled updates count as one stall event
- Stalls are subtracted from the streaming window when computing generation TPS
- The stall clock resets at each `message_start`, so tool-execution gaps between messages are never counted as stalls

When a stall occurs **before** the first stream update (common in request-queuing scenarios), the TPS algorithm detects the artifact and falls back to a conservative estimate rather than producing an inflated rate.

### TPS algorithm (three-branch gate)

The extension uses a defense-in-depth strategy to produce reliable TPS:

1. **Decode primary branch** — Requires ≥5 streaming updates with ≥1ms average inter-chunk gap and stall time < active generation time. Subtracts stalls from the streaming window for pure decode speed.

2. **Decode fallback branch** — When the decode primary conditions fail but ≥2 updates exist and total generation time ≥200ms. Uses the full generation window, which includes TTFT and therefore produces a conservative rate. Applies partial stall reduction when stalls dominate.

3. **Output-window metrics** — `generationTps` uses the complete assistant-message window, while `wallTps` uses the interval from the first non-empty `text_delta` to `message_end`, excluding TTFT and post-output tool handling. Turns without visible text do not expose `wallTps` as the primary displayed TPS. Both are calculated independently of whether the decode primary or fallback branch was used.

4. **Sanity gate** — All three metrics are set to `null` (displayed as `—`) when their calculated rate exceeds the maximum plausible TPS threshold. Decode also returns `null` when timing is structurally unidentifiable: burst delivery, too few chunks, or a generation window too short for a reliable rate.

---

## Rehydration

When you resume a session (or navigate branches with `/tree`), pi-tps restores the most recent TPS notification — so you can see your last turn's stats after a reload.

Supports both the current structured `TurnTelemetry` format and legacy `{ message, timestamp }` entries for backward compatibility with session files created by earlier versions.

---

## Export command

Dump telemetry as JSONL for inspection or analysis:

```bash
/tps-export             # current branch, all custom entries
/tps-export --full      # all branches in the session
/tps-export tps         # current branch, filter by customType "tps"
/tps-export tps --full  # all branches, filter by customType "tps"
```

Each exported file is written to `~/.cache/pi-telemetry/pi-telemetry-{scope}-{sessionId}-{timestamp}.jsonl`.

The exporter includes **structural entries** (model_change, branch_summary) alongside telemetry entries so the exported tree is fully resolvable — the web inspector can show model switches and branch points. Parent IDs are automatically re-chained to point to the nearest ancestor that's included in the export, producing a self-contained tree.

---

## Telemetry event

After each turn, pi-tps emits a `tps:telemetry` event on pi's shared event bus. Other extensions can listen to build custom widgets, dashboards, or cost trackers.

```typescript
pi.events.on('tps:telemetry', (data) => {
  // data matches the TurnTelemetry structure below
  console.log(data.tps, data.tokens, data.timing);
});
```

The event payload:

| Field                 | Type                                 | Description                                                                                                                                                           |
| --------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tps`                 | `number \| null`                     | Tokens per second, or null when unidentifiable                                                                                                                        |
| `model.provider`      | `string`                             | Provider name (e.g. `openai`)                                                                                                                                         |
| `model.modelId`       | `string`                             | Model identifier (e.g. `gpt-4`)                                                                                                                                       |
| `tokens.input`        | `number`                             | Input tokens (summed across all assistant messages)                                                                                                                   |
| `tokens.output`       | `number`                             | Output tokens generated by the LLM                                                                                                                                    |
| `tokens.cacheRead`    | `number`                             | Cache-read tokens (provider-dependent)                                                                                                                                |
| `tokens.cacheWrite`   | `number`                             | Cache-write tokens (provider-dependent)                                                                                                                               |
| `tokens.total`        | `number`                             | Total tokens (input + output + cache)                                                                                                                                 |
| `timing.ttftMs`       | `number \| null`                     | Time to first token in milliseconds                                                                                                                                   |
| `timing.totalMs`      | `number`                             | Total wall-clock time from request to completion                                                                                                                      |
| `timing.generationMs` | `number`                             | Streaming wall clock (message_start → message_end)                                                                                                                    |
| `timing.streamMs`     | `number \| null`                     | Inter-update span: first → last streaming update                                                                                                                      |
| `timing.stallMs`      | `number`                             | Accumulated inference stall time in ms                                                                                                                                |
| `timing.stallCount`   | `number`                             | Number of discrete stall events                                                                                                                                       |
| `timing.messageCount` | `number`                             | Assistant messages in this turn                                                                                                                                       |
| `decodeTps`           | `number \| null`                     | Inter-update decode TPS, excluding TTFT and known stalls                                                                                                              |
| `generationTps`       | `number \| null`                     | Assistant-generation wall-clock TPS, excluding gaps between assistant messages                                                                                        |
| `wallTps`             | `number \| null`                     | Output-window TPS from first non-empty `text_delta` to assistant `message_end`; excludes post-output tool handling and is null as primary TPS without visible text    |
| `primaryMetric`       | `"decode" \| "generation" \| "wall"` | Metric selected for the primary `tps` value                                                                                                                           |
| `cost.input`          | `number \| null`                     | Input token cost                                                                                                                                                      |
| `cost.output`         | `number \| null`                     | Output token cost                                                                                                                                                     |
| `cost.cacheRead`      | `number \| null`                     | Cache-read token cost                                                                                                                                                 |
| `cost.cacheWrite`     | `number \| null`                     | Cache-write token cost                                                                                                                                                |
| `cost.total`          | `number \| null`                     | Total cost for this turn                                                                                                                                              |
| `timestamp`           | `number`                             | Unix timestamp (ms) when telemetry was computed                                                                                                                       |
| `rateUsdPerMTokens`   | `number \| null`                     | Blended $/M-tokens rate for this turn (Neuralwatt billed cost when available, else list-price compute cost). `null` when no cost source is usable or tokens are zero. |

When `cost` is unavailable (provider doesn't report it), the entire `cost` object is `null`.

---

## Testing

Dev tooling (vitest, typescript, hooks) stays in the git repo only — use `pnpm` for local development.

```bash
# Install dev dependencies (repo checkout only)
bun install

# Run tests
bun run test

# Run tests with coverage
bun run test:coverage

# Type check
bun run typecheck

# Verify published tarball contents (should be ~3 runtime files)
bun run pack:check
```

---

## License

MIT
