import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseSSELine, parseSSEStream } from "../parser";
import { createSSEHandler } from "../server";
import { sseTransport } from "../client";
import type { PenStreamPart, PenStreamRequest } from "@pen/types";
import type { SSEEvent } from "../types";

type FetchCall = [input: string | URL | globalThis.Request, init?: RequestInit];

function makeRequest(
	overrides: Partial<PenStreamRequest> = {},
): PenStreamRequest {
	return {
		prompt: "test",
		toolCalls: [{ toolCallId: "tc-1", name: "echo", input: { msg: "hi" } }],
		...overrides,
	};
}

async function readAllSSEEvents(response: Response): Promise<SSEEvent[]> {
	const events: SSEEvent[] = [];
	const reader = response.body!.getReader();
	const decoder = new TextDecoder();
	let buffer = "";
	let pending: Partial<SSEEvent> = {};

	while (true) {
		const { done, value } = await reader.read();
		if (done) break;

		buffer += decoder.decode(value, { stream: true });
		const lines = buffer.split("\n");
		buffer = lines.pop() ?? "";

		for (const line of lines) {
			const result = parseSSELine(line, pending);
			pending = result.pending;
			if (result.event) events.push(result.event);
		}
	}

	if (buffer.length > 0) {
		const result = parseSSELine(buffer, pending);
		if (result.event) events.push(result.event);
	}

	return events;
}

async function collectParts(
	iter: AsyncIterable<PenStreamPart>,
): Promise<PenStreamPart[]> {
	const parts: PenStreamPart[] = [];
	for await (const part of iter) {
		parts.push(part);
	}
	return parts;
}

describe("SSE parser", () => {
	it("parses basic data event", () => {
		let pending: Partial<SSEEvent> = {};

		const r1 = parseSSELine('data: {"type":"done"}', pending);
		pending = r1.pending;
		expect(r1.event).toBeNull();

		const r2 = parseSSELine("", pending);
		expect(r2.event).toEqual({ data: '{"type":"done"}' });
	});

	it("handles multi-line data", () => {
		let pending: Partial<SSEEvent> = {};

		pending = parseSSELine("data: line1", pending).pending;
		pending = parseSSELine("data: line2", pending).pending;
		const result = parseSSELine("", pending);

		expect(result.event?.data).toBe("line1\nline2");
	});

	it("ignores comment lines", () => {
		let pending: Partial<SSEEvent> = {};
		const result = parseSSELine(": keepalive", pending);
		expect(result.event).toBeNull();
		expect(result.pending).toBe(pending);
	});

	it("parses id and event fields", () => {
		let pending: Partial<SSEEvent> = {};
		pending = parseSSELine("id: abc-123:0", pending).pending;
		pending = parseSSELine("event: message", pending).pending;
		pending = parseSSELine('data: {"type":"ping"}', pending).pending;
		const result = parseSSELine("", pending);

		expect(result.event).toEqual({
			id: "abc-123:0",
			event: "message",
			data: '{"type":"ping"}',
		});
	});

	it("parses retry field as integer", () => {
		let pending: Partial<SSEEvent> = {};
		pending = parseSSELine("retry: 3000", pending).pending;
		pending = parseSSELine('data: {"type":"done"}', pending).pending;
		const result = parseSSELine("", pending);

		expect(result.event?.retry).toBe(3000);
	});
});

describe("SSE server handler", () => {
	it("returns text/event-stream content type (AC 16)", async () => {
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() { },
				unregisterTool() { },
				listTools: () => [],
				getTool: () => null,
				executeTool: async () => "result",
			},
			pingInterval: 60_000,
		});

		const request = new Request("http://localhost/sse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeRequest()),
		});

		const response = await handler(request);

		expect(response.status).toBe(200);
		expect(response.headers.get("Content-Type")).toBe("text/event-stream");
		expect(response.headers.get("Cache-Control")).toBe("no-cache");
		expect(response.headers.get("X-Stream-Id")).toBeTruthy();

		await response.body?.cancel();
	});

	it("event IDs use monotonic streamId:eventIndex format (AC 8)", async () => {
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() { },
				unregisterTool() { },
				listTools: () => [],
				getTool: () => null,
				executeTool: async () => "result",
			},
			pingInterval: 60_000,
		});

		const request = new Request("http://localhost/sse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeRequest()),
		});

		const response = await handler(request);
		const streamId = response.headers.get("X-Stream-Id")!;
		const events = await readAllSSEEvents(response);

		for (let i = 0; i < events.length; i++) {
			expect(events[i].id).toBe(`${streamId}:${i}`);
		}
	});

	it("yields tool-output and done parts for Promise-based tools (AC 7)", async () => {
		const handler = createSSEHandler({
			toolRuntime: {
				registerTool() { },
				unregisterTool() { },
				listTools: () => [],
				getTool: () => null,
				executeTool: async () => ({ msg: "ok" }),
			},
			pingInterval: 60_000,
		});

		const request = new Request("http://localhost/sse", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(makeRequest()),
		});

		const response = await handler(request);
		const events = await readAllSSEEvents(response);

		const parts = events.map((e) => JSON.parse(e.data) as PenStreamPart);

		const toolOutput = parts.find((p) => p.type === "tool-output");
		expect(toolOutput).toMatchObject({
			type: "tool-output",
			toolCallId: "tc-1",
			output: { msg: "ok" },
		});

		const done = parts.find((p) => p.type === "done");
		expect(done).toMatchObject({ type: "done" });
	});

	it("GET reconnect without Last-Event-ID returns 400", async () => {
		const handler = createSSEHandler({ pingInterval: 60_000 });

		const request = new Request("http://localhost/sse", { method: "GET" });
		const response = await handler(request);

		expect(response.status).toBe(400);
	});

	it("GET reconnect returns 501 for M0 (AC 15)", async () => {
		const handler = createSSEHandler({ pingInterval: 60_000 });

		const request = new Request("http://localhost/sse", {
			method: "GET",
			headers: { "Last-Event-ID": "some-stream:5" },
		});

		const response = await handler(request);

		expect(response.status).toBe(501);
		expect(response.headers.get("X-Replay-Supported")).toBe("false");
	});
});

describe("SSE client transport", () => {
	let originalFetch: typeof globalThis.fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	function sseBody(events: Array<{ id?: string; data: string }>): ReadableStream<Uint8Array> {
		const encoder = new TextEncoder();
		return new ReadableStream({
			start(controller) {
				for (const evt of events) {
					let chunk = "";
					if (evt.id) chunk += `id: ${evt.id}\n`;
					chunk += `data: ${evt.data}\n\n`;
					controller.enqueue(encoder.encode(chunk));
				}
				controller.close();
			},
		});
	}

	it("ping parts from server are consumed but NOT yielded to consumer (AC 9)", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(
				sseBody([
					{ id: "s:0", data: '{"type":"ping"}' },
					{ id: "s:1", data: '{"type":"tool-output","toolCallId":"tc-1","output":"ok"}' },
					{ id: "s:2", data: '{"type":"ping"}' },
					{ id: "s:3", data: '{"type":"done"}' },
				]),
				{ status: 200, headers: { "Content-Type": "text/event-stream" } },
			),
		);

		const transport = sseTransport({ url: "http://test/sse", pingTimeout: 30_000 });
		const parts = await collectParts(transport.stream(makeRequest()));

		expect(parts.every((p) => p.type !== "ping")).toBe(true);
		expect(parts).toHaveLength(2);
		expect(parts[0].type).toBe("tool-output");
		expect(parts[1].type).toBe("done");
	});

	it("client connected → false when pingTimeout elapses without events (AC 10)", async () => {
		const encoder = new TextEncoder();
		let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;

		globalThis.fetch = vi.fn(async () => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					ctrl = controller;
					controller.enqueue(encoder.encode('data: {"type":"tool-output","toolCallId":"tc-1","output":"x"}\n\n'));
				},
			});
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		});

		const transport = sseTransport({ url: "http://test/sse", pingTimeout: 50 });
		const connectionChanges: boolean[] = [];
		transport.onConnectionChange((v) => connectionChanges.push(v));

		const parts: PenStreamPart[] = [];
		const streamIter = transport.stream(makeRequest())[Symbol.asyncIterator]();

		const first = await streamIter.next();
		parts.push(first.value!);

		expect(transport.connected).toBe(true);

		await new Promise((r) => setTimeout(r, 80));

		expect(transport.connected).toBe(false);
		expect(connectionChanges).toContain(false);

		if (ctrl) {
			ctrl.enqueue(encoder.encode('data: {"type":"done"}\n\n'));
		}
		await transport.disconnect();
	});

	it("disconnect() aborts active fetch and sets connected = false (AC 11)", async () => {
		const encoder = new TextEncoder();

		globalThis.fetch = vi.fn(async () => {
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(encoder.encode('data: {"type":"tool-output","toolCallId":"tc-1","output":"hi"}\n\n'));
				},
			});
			return new Response(body, {
				status: 200,
				headers: { "Content-Type": "text/event-stream" },
			});
		});

		const transport = sseTransport({ url: "http://test/sse" });
		const parts: PenStreamPart[] = [];

		const consumePromise = (async () => {
			try {
				for await (const part of transport.stream(makeRequest())) {
					parts.push(part);
					if (parts.length === 1) {
						await transport.disconnect();
						break;
					}
				}
			} catch {
				// Abort may cause iterator to throw
			}
		})();

		await consumePromise;

		expect(transport.connected).toBe(false);
		expect(parts).toHaveLength(1);
	});

	it("onConnectionChange() fires on state transitions (AC 12)", async () => {
		globalThis.fetch = vi.fn(async () =>
			new Response(
				sseBody([
					{ id: "s:0", data: '{"type":"done"}' },
				]),
				{ status: 200, headers: { "Content-Type": "text/event-stream" } },
			),
		);

		const transport = sseTransport({ url: "http://test/sse" });
		const changes: boolean[] = [];
		transport.onConnectionChange((v) => changes.push(v));

		expect(transport.connected).toBe(false);

		await collectParts(transport.stream(makeRequest()));

		expect(changes[0]).toBe(true);
	});

	it("connect() makes HEAD request and sets connected based on response (AC 13)", async () => {
		globalThis.fetch = vi.fn(async (url: string | URL | globalThis.Request, init?: RequestInit) => {
			const req = init ?? {};
			if (req.method === "HEAD") {
				return new Response(null, { status: 200 });
			}
			return new Response(null, { status: 404 });
		});

		const transport = sseTransport({ url: "http://test/sse" });
		expect(transport.connected).toBe(false);

		await transport.connect();
		expect(transport.connected).toBe(true);

		const fetchCalls = (globalThis.fetch as ReturnType<typeof vi.fn>).mock
			.calls as FetchCall[];
		const headCall = fetchCalls.find((c) => c[1]?.method === "HEAD");
		expect(headCall).toBeDefined();
	});

	it("reconnect() sends GET with Last-Event-ID header (AC 14)", async () => {
		const fetchSpy = vi.fn(async (_url: string | URL | globalThis.Request, init?: RequestInit) => {
			const reqHeaders = init?.headers as Record<string, string> | undefined;
			if (init?.method === "GET" && reqHeaders?.["Last-Event-ID"]) {
				return new Response(null, {
					status: 501,
					headers: { "X-Replay-Supported": "false" },
				});
			}
			return new Response(null, { status: 404 });
		});
		globalThis.fetch = fetchSpy;

		const transport = sseTransport({
			url: "http://test/sse",
			maxReconnectAttempts: 1,
		});

		const parts = await collectParts(transport.reconnect!("stream-123:5"));

		expect(parts).toHaveLength(1);
		expect(parts[0]).toMatchObject({
			type: "error",
			code: "REPLAY_UNSUPPORTED",
		});

		const getCall = (fetchSpy.mock.calls as FetchCall[]).find(
			(c) => c[1]?.method === "GET",
		);
		expect(getCall).toBeDefined();
		const sentHeaders = getCall![1]?.headers as Record<string, string>;
		expect(sentHeaders["Last-Event-ID"]).toBe("stream-123:5");
		expect(sentHeaders["Accept"]).toBe("text/event-stream");
	});
});
