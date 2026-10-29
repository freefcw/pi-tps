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

describe('pi-tps wall TPS timing', () => {
  let fixture: ReturnType<typeof createTestFixture>;

  beforeEach(() => {
    fixture = createTestFixture();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses the first text delta through message_end for wall TPS', async () => {
    fixture.settings.tps = { primaryMetric: 'wall' };
    await activateExtension(fixture);
    const { handlers, appendEntrySpy } = fixture;
    const message = makeMessage();
    const timestamps = [
      0, // turn_start
      0, // turn_start
      100, // message_start
      200, // first text delta
      300, // message_end
      2000, // turn_end, including post-output tool execution
    ];
    let callIndex = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      return timestamps[Math.min(callIndex++, timestamps.length - 1)];
    });

    handlers['turn_start']?.({ type: 'turn_start', turnIndex: 0, timestamp: Date.now() });
    handlers['message_start']?.({ type: 'message_start', message });
    handlers['message_update']?.({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', delta: 'H' },
    });
    handlers['message_end']?.({ type: 'message_end', message });
    handlers['tool_execution_start']?.({
      type: 'tool_execution_start',
      toolCallId: 'call_1',
      toolName: 'bash',
      args: {},
    });
    handlers['turn_end']?.(
      { type: 'turn_end', turnIndex: 0, message, toolResults: [] },
      fixture.mockCtx
    );
    spy.mockRestore();

    const telemetry = appendEntrySpy.mock.calls[0][1] as Record<string, any>;
    expect(telemetry.wallTps).toBeCloseTo(2000, 1); // 200 / (300 - 200) ms
  });

  it('does not include post-output tool handling in the wall window', async () => {
    fixture.settings.tps = { primaryMetric: 'wall' };
    await activateExtension(fixture);
    const { handlers, appendEntrySpy } = fixture;
    const message = makeMessage(100);
    const timestamps = [
      0, // turn_start: turnStartMs
      0, // turn_start: lastUpdateMs
      100, // message_start
      200, // first text delta
      500, // message_end
      3000, // turn_end after post-output tool handling
    ];
    let callIndex = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      return timestamps[Math.min(callIndex++, timestamps.length - 1)];
    });

    handlers['turn_start']?.({ type: 'turn_start', turnIndex: 0, timestamp: Date.now() });
    handlers['message_start']?.({ type: 'message_start', message });
    handlers['message_update']?.({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', delta: 'H' },
    });
    handlers['message_end']?.({ type: 'message_end', message });
    handlers['turn_end']?.(
      { type: 'turn_end', turnIndex: 0, message, toolResults: [] },
      fixture.mockCtx
    );
    spy.mockRestore();

    const telemetry = appendEntrySpy.mock.calls[0][1] as Record<string, any>;
    expect(telemetry.timing.messageCount).toBe(1);
    expect(telemetry.timing.generationMs).toBe(400);
    expect(telemetry.timing.totalMs).toBe(3000);
    expect(telemetry.wallTps).toBeCloseTo(333.3, 1);
  });

  it('starts wall TPS at the first non-empty text delta', async () => {
    fixture.settings.tps = { primaryMetric: 'wall' };
    await activateExtension(fixture);
    const { handlers, appendEntrySpy } = fixture;
    const message = makeMessage();
    const timestamps = [
      0, // turn_start: turnStartMs
      0, // turn_start: lastUpdateMs
      100, // message_start
      150, // thinking_delta (after thinking_start, which is not timed)
      200, // first text_delta (after text_start, which is not timed)
      250, // second text_delta
      300, // message_end
      400, // turn_end
    ];
    let callIndex = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      return timestamps[Math.min(callIndex++, timestamps.length - 1)];
    });

    handlers['turn_start']?.({ type: 'turn_start', turnIndex: 0, timestamp: Date.now() });
    handlers['message_start']?.({ type: 'message_start', message });
    handlers['message_update']?.({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'thinking_start' },
    });
    handlers['message_update']?.({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'thinking_delta', delta: 'reasoning' },
    });
    handlers['message_update']?.({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_start' },
    });
    handlers['message_update']?.({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', delta: 'H' },
    });
    handlers['message_update']?.({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', delta: 'i' },
    });
    handlers['message_end']?.({ type: 'message_end', message });
    handlers['turn_end']?.(
      { type: 'turn_end', turnIndex: 0, message, toolResults: [] },
      fixture.mockCtx
    );
    spy.mockRestore();

    const telemetry = appendEntrySpy.mock.calls[0][1] as Record<string, any>;
    expect(telemetry.timing.ttftMs).toBe(150);
    expect(telemetry.wallTps).toBeCloseTo(2000, 1); // 200 / (300 - 200) ms
  });

  it('accumulates generation time when message_start occurs at performance.now() = 0', async () => {
    fixture.settings.tps = { primaryMetric: 'generation' };
    await activateExtension(fixture);
    const { handlers, appendEntrySpy } = fixture;
    const message = makeMessage();
    const timestamps = [
      0, // turn_start: turnStartMs
      0, // turn_start: lastUpdateMs
      0, // message_start
      100, // first text_delta
      200, // second text_delta
      300, // message_end
      300, // turn_end
    ];
    let callIndex = 0;
    const spy = vi.spyOn(performance, 'now').mockImplementation(() => {
      return timestamps[Math.min(callIndex++, timestamps.length - 1)];
    });

    handlers['turn_start']?.({ type: 'turn_start', turnIndex: 0, timestamp: Date.now() });
    handlers['message_start']?.({ type: 'message_start', message });
    handlers['message_update']?.({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', delta: 'H' },
    });
    handlers['message_update']?.({
      type: 'message_update',
      message,
      assistantMessageEvent: { type: 'text_delta', delta: 'i' },
    });
    handlers['message_end']?.({ type: 'message_end', message });
    handlers['turn_end']?.(
      { type: 'turn_end', turnIndex: 0, message, toolResults: [] },
      fixture.mockCtx
    );
    spy.mockRestore();

    const telemetry = appendEntrySpy.mock.calls[0][1] as Record<string, any>;
    expect(telemetry.timing.generationMs).toBe(300);
    expect(telemetry.generationTps).toBeCloseTo(666.7, 1);
  });
});
