import { describe, it, expect, vi } from "vitest";
import { directTransport } from "../directTransport";
import type { PenStreamPart, PenStreamRequest, ToolRuntime } from "@pen/types";

type ToolExecutionContext = Parameters<ToolRuntime["executeTool"]>[2];

function createMockToolRuntime(
  handler: (
    name: string,
    input: unknown,
    ctx: ToolExecutionContext,
  ) => Promise<unknown> | AsyncIterable<unknown>,
): ToolRuntime {
  return {
    registerTool: vi.fn(),
    unregisterTool: vi.fn(),
    listTools: () => [],
    getTool: () => null,
    executeTool: handler,
  };
}

function makeRequest(
  overrides: Partial<PenStreamRequest> = {},
): PenStreamRequest {
  return {
    prompt: "test",
    toolCalls: [{ toolCallId: "tc-1", name: "test-tool", input: { a: 1 } }],
    ...overrides,
  };
}

async function collectParts(
  iterable: AsyncIterable<PenStreamPart>,
): Promise<PenStreamPart[]> {
  const parts: PenStreamPart[] = [];
  for await (const part of iterable) {
    parts.push(part);
  }
  return parts;
}

describe("@pen/transport-direct", () => {
  it("returns a PenTransport with connected === true (AC 1)", () => {
    const toolRuntime = createMockToolRuntime(async () => "ok");
    const transport = directTransport({ toolRuntime });

    expect(transport.connected).toBe(true);
  });

  it("yields tool-output + done from a Promise-returning tool (AC 2)", async () => {
    const toolRuntime = createMockToolRuntime(async () => ({
      result: "hello",
    }));
    const transport = directTransport({ toolRuntime });

    const parts = await collectParts(transport.stream(makeRequest()));

    expect(parts).toHaveLength(2);
    expect(parts[0]).toMatchObject({
      type: "tool-output",
      toolCallId: "tc-1",
      output: { result: "hello" },
    });
    expect(parts[1]).toMatchObject({ type: "done" });
  });

  it("forwards each part from an AsyncIterable-returning tool (AC 3)", async () => {
    async function* streamingTool(): AsyncIterable<PenStreamPart> {
      yield { type: "gen-start", zoneId: "z1", blockId: "b1" };
      yield { type: "gen-delta", zoneId: "z1", delta: "hello " };
      yield { type: "gen-delta", zoneId: "z1", delta: "world" };
      yield {
        type: "gen-end",
        zoneId: "z1",
        status: "complete",
      };
    }

    const toolRuntime = createMockToolRuntime(() => streamingTool());
    const transport = directTransport({ toolRuntime });

    const parts = await collectParts(transport.stream(makeRequest()));

    expect(parts[0]).toMatchObject({
      type: "gen-start",
      zoneId: "z1",
    });
    expect(parts[1]).toMatchObject({
      type: "gen-delta",
      delta: "hello ",
    });
    expect(parts[2]).toMatchObject({
      type: "gen-delta",
      delta: "world",
    });
    expect(parts[3]).toMatchObject({
      type: "gen-end",
      status: "complete",
    });
    expect(parts[4]).toMatchObject({ type: "done" });
  });

  it("disconnect() aborts active streams (AC 4)", async () => {
    let yieldCount = 0;
    async function* slowTool(): AsyncIterable<PenStreamPart> {
      for (let i = 0; i < 100; i++) {
        yieldCount++;
        yield { type: "gen-delta", zoneId: "z1", delta: `${i}` };
        await new Promise((r) => setTimeout(r, 10));
      }
    }

    const toolRuntime = createMockToolRuntime(() => slowTool());
    const transport = directTransport({ toolRuntime });

    const partsPromise = collectParts(transport.stream(makeRequest()));

    await new Promise((r) => setTimeout(r, 50));
    await transport.disconnect();

    const parts = await partsPromise;
    expect(parts.length).toBeLessThan(100);
  });

  it("tool execution error yields error part, not thrown (AC 5)", async () => {
    const onError = vi.fn();
    const toolRuntime = createMockToolRuntime(async () => {
      throw new Error("tool failed");
    });
    const transport = directTransport({ toolRuntime, onError });

    const parts = await collectParts(transport.stream(makeRequest()));

    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "error",
      errorText: "tool failed",
    });
    expect(onError).toHaveBeenCalledOnce();
  });

  it("onConnectionChange() never fires (AC 6)", async () => {
    const toolRuntime = createMockToolRuntime(async () => "ok");
    const transport = directTransport({ toolRuntime });

    const callback = vi.fn();
    const unsub = transport.onConnectionChange(callback);

    await transport.connect();
    await transport.disconnect();

    expect(callback).not.toHaveBeenCalled();
    unsub();
  });
});
