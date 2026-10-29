import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { createTestFixture, activateExtension } from './helpers';

function makeMessage(output = 200): AssistantMessage {
  return {
    role: 'assistant',
    content: [{ type: 'text', text: 'Response' }],
    api: 'openai-completions',
    provider: 'openai',
    model: 'gpt-4',
    usage: {
      input: 100,
      output,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 300,
    },
    stopReason: 'stop',
    timestamp: Date.now(),
  };
}

describe('pi-tps primary metric configuration', () => {
  let fixture: ReturnType<typeof createTestFixture>;

  beforeEach(() => {
    fixture = createTestFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function driveTurn(
    primaryMetric: string | undefined,
    {
      streamUpdates = 5,
      activate = true,
      turnIndex = 0,
    }: { streamUpdates?: number; activate?: boolean; turnIndex?: number } = {}
  ) {
    if (primaryMetric !== undefined) fixture.settings.tps = { primaryMetric };
    if (activate) await activateExtension(fixture);
    const { handlers, appendEntrySpy, notifySpy } = fixture;
    const message = makeMessage();
    const timestamps = [
      0, // turn_start: turnStartMs
      0, // turn_start: lastUpdateMs
      100, // message_start
      200, // first update: TTFT
      ...Array.from({ length: streamUpdates }, (_, i) => 300 + i * 100),
      800, // message_end
      2000, // turn_end: total turn window is 2000ms
    ];
    let callIndex = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      return timestamps[Math.min(callIndex++, timestamps.length - 1)];
    });

    handlers['turn_start']?.({ type: 'turn_start', turnIndex, timestamp: Date.now() });
    handlers['message_start']?.({ type: 'message_start', message });
    handlers['message_update']?.({ type: 'message_update', message });
    for (let i = 0; i < streamUpdates; i++) {
      handlers['message_update']?.({ type: 'message_update', message });
    }
    handlers['message_end']?.({ type: 'message_end', message });
    handlers['turn_end']?.(
      { type: 'turn_end', turnIndex, message, toolResults: [] },
      fixture.mockCtx
    );
    spy.mockRestore();

    const lastAppendCall = appendEntrySpy.mock.calls.at(-1)!;
    const lastNotificationCall = notifySpy.mock.calls.at(-1)!;
    return {
      telemetry: lastAppendCall[1] as Record<string, any>,
      notification: lastNotificationCall[0] as string,
    };
  }

  it('defaults to wall TPS for user-facing output speed', async () => {
    const { telemetry, notification } = await driveTurn(undefined);

    expect(telemetry.primaryMetric).toBe('wall');
    expect(telemetry.decodeTps).toBe(500);
    expect(telemetry.generationTps).toBeCloseTo(285.7, 1);
    expect(telemetry.wallTps).toBeCloseTo(333.3, 1);
    expect(telemetry.tps).toBe(telemetry.wallTps);
    expect(notification).toContain('TPS 333.3 tok/s');
  });

  it.each([
    ['generation', 285.7],
    ['wall', 333.3],
  ] as const)('uses %s as the primary displayed TPS', async (primaryMetric, expected) => {
    const { telemetry, notification } = await driveTurn(primaryMetric);

    expect(telemetry.primaryMetric).toBe(primaryMetric);
    expect(telemetry.tps).toBe(expected);
    expect(notification).toContain(`TPS ${expected.toFixed(1)} tok/s`);
    expect(telemetry.decodeTps).toBe(500);
    expect(telemetry.generationTps).toBeCloseTo(285.7, 1);
    expect(telemetry.wallTps).toBeCloseTo(333.3, 1);
  });

  it('falls back to wall for invalid configuration', async () => {
    const { telemetry } = await driveTurn('invalid');
    expect(telemetry.primaryMetric).toBe('wall');
    expect(telemetry.tps).toBe(telemetry.wallTps);
  });

  it('reads a changed primary metric on the next turn', async () => {
    await driveTurn('decode');

    fixture.settings.tps = { primaryMetric: 'wall' };
    const { telemetry, notification } = await driveTurn(undefined, {
      activate: false,
      turnIndex: 1,
    });

    expect(telemetry.primaryMetric).toBe('wall');
    expect(telemetry.tps).toBe(telemetry.wallTps);
    expect(notification).toContain(`TPS ${telemetry.wallTps.toFixed(1)} tok/s`);
  });

  it('defaults to wall when getSettings is unavailable', async () => {
    (fixture.mockPi as any).getSettings = undefined;
    const { telemetry } = await driveTurn(undefined);

    expect(telemetry.primaryMetric).toBe('wall');
    expect(telemetry.tps).toBe(telemetry.wallTps);
  });
});
