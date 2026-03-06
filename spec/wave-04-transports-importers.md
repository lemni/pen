# Wave 4 — Transports & Importers

**Milestone:** M0 · **Packages:** `@pen/transport-direct`, `@pen/transport-sse`, `@pen/import-markdown`, `@pen/import-html` · **Depends on:** Waves 0-3

---

## Goal

Implement the two transport layers needed for M0 (in-process and SSE) and the two importers needed for paste and document import. After this wave, you can stream AI output to an editor over SSE or in-process, and paste HTML/Markdown content. These are the bridge packages — they connect the headless editor (Waves 0-3) to external data sources (LLM streams, clipboard, files).

---

## Package 1: `@pen/transport-direct`

In-process transport — no network (Spec Section 11.3). Essential for testing, Mode B (client-only) deployments, and headless server-side operation where the `ToolServer` runs in the same process.

### File Structure

```
packages/transports/direct/src/
├── direct-transport.ts     Factory + PenTransport implementation
└── index.ts                Package entry
```

Two files. The direct transport is intentionally minimal — it exists to satisfy the `PenTransport` interface without network overhead.

### Module: `direct-transport.ts`

```typescript
import type {
  PenTransport,
  PenStreamRequest,
  PenStreamPart,
  Unsubscribe,
  ToolServer,
} from '@pen/types';

export interface DirectTransportOptions {
  toolServer: ToolServer;
  onError?: (error: unknown) => void;
}

export function directTransport(options: DirectTransportOptions): PenTransport {
  const { toolServer, onError } = options;
  const activeControllers = new Set<AbortController>();

  const transport: PenTransport = {
    async *stream(request: PenStreamRequest): AsyncIterable<PenStreamPart> {
      const controller = new AbortController();
      activeControllers.add(controller);
      const signal = controller.signal;

      try {
        for (const toolCall of request.toolCalls ?? []) {
          if (signal.aborted) break;

          const result = toolServer.executeTool(
            toolCall.name,
            toolCall.input,
            { toolCallId: toolCall.toolCallId, ...request.context },
          );

          if (isAsyncIterable(result)) {
            for await (const part of result) {
              if (signal.aborted) break;
              yield part as PenStreamPart;
            }
          } else {
            const resolved = await result;
            yield {
              type: 'tool-output',
              toolCallId: toolCall.toolCallId,
              output: resolved,
            } as PenStreamPart;
          }
        }

        yield { type: 'done' } as PenStreamPart;
      } catch (error) {
        onError?.(error);
        yield {
          type: 'error',
          errorText: error instanceof Error ? error.message : String(error),
        } as PenStreamPart;
      } finally {
        activeControllers.delete(controller);
      }
    },

    async connect(): Promise<void> {
      // No-op — always connected
    },

    async disconnect(): Promise<void> {
      for (const controller of activeControllers) {
        controller.abort();
      }
      activeControllers.clear();
    },

    get connected(): boolean {
      return true;
    },

    onConnectionChange(_callback: (connected: boolean) => void): Unsubscribe {
      // Never fires — always connected
      return () => {};
    },
  };

  return transport;
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in (value as object)
  );
}
```

**Key design decisions:**

- **No `reconnect()`.** In-process connections never drop. The optional `reconnect` property on `PenTransport` is not implemented.
- **Abort via `AbortController`.** `disconnect()` aborts all active streams. Each `stream()` call gets its own `AbortController` tracked in a `Set`, so concurrent streams are independent. The generator checks `signal.aborted` between yields to bail promptly.
- **Error isolation.** Tool execution errors are caught and yielded as `error` parts, not thrown. This keeps the stream protocol consistent — consumers always handle errors via stream parts, never via try/catch on the iterable.
- **`onError` callback.** Optional hook for logging/diagnostics. Fires before the error part is yielded.
- **Single-request model.** Each `stream()` call processes one `PenStreamRequest`. Concurrent calls are supported (each gets its own generator).

### Module: `index.ts`

```typescript
export { directTransport } from './direct-transport.js';
export type { DirectTransportOptions } from './direct-transport.js';
```

### Dependencies

None beyond `@pen/core` (workspace dependency for types).

---

## Package 2: `@pen/transport-sse`

SSE over HTTP transport (Spec Section 11.3). The default network transport for Mode B client-only deployments and Mode A client↔server streaming.

### File Structure

```
packages/transports/sse/src/
├── client.ts              SSE client transport (PenTransport implementation)
├── server.ts              SSE server handler factory
├── parser.ts              SSE line protocol parser
├── types.ts               Shared types (SSEEvent, SSEClientOptions, SSEServerOptions)
└── index.ts               Package entry
```

Four focused modules. The parser is extracted because both client (for testing) and server need to understand the SSE wire format.

### Import DAG

```
types.ts    ← (no imports)
parser.ts   ← types.ts
client.ts   ← types.ts, parser.ts, (@pen/core)
server.ts   ← types.ts, (@pen/core)
index.ts    ← client.ts, server.ts
```

No cycles.

### Module: `types.ts`

```typescript
import type { PenStreamPart, PenStreamRequest, ServerConfig } from '@pen/types';

export interface SSEEvent {
  id?: string;
  data: string;
  event?: string;
  retry?: number;
}

export interface SSEClientOptions {
  url: string;
  headers?: Record<string, string>;
  reconnect?: boolean;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
  supportsReplay?: boolean;
  pingTimeout?: number;
  signal?: AbortSignal;
}

export interface SSEServerOptions {
  toolServer?: import('@pen/core').ToolServer;
  editor?: import('@pen/core').Editor;
  onRequest?: (request: PenStreamRequest) => void;
  onError?: (error: unknown) => void;
  pingInterval?: number;
  keepAliveComment?: boolean;
}

export interface SSEStreamState {
  streamId: string;
  eventIndex: number;
  parts: PenStreamPart[];
}
```

### Module: `parser.ts`

The SSE line protocol parser. Handles the `data:`, `id:`, `event:`, and `retry:` fields per the [SSE spec](https://html.spec.whatwg.org/multipage/server-sent-events.html).

```typescript
import type { SSEEvent } from './types.js';

export function parseSSELine(
  line: string,
  pending: Partial<SSEEvent>,
): { event: SSEEvent | null; pending: Partial<SSEEvent> } {
  if (line === '') {
    if (pending.data !== undefined) {
      const event: SSEEvent = {
        data: pending.data,
        id: pending.id,
        event: pending.event,
        retry: pending.retry,
      };
      return { event, pending: {} };
    }
    return { event: null, pending: {} };
  }

  if (line.startsWith(':')) {
    return { event: null, pending };
  }

  const colonIndex = line.indexOf(':');
  if (colonIndex === -1) {
    return { event: null, pending: { ...pending, [line]: '' } };
  }

  const field = line.slice(0, colonIndex);
  const value = line.slice(colonIndex + 1).replace(/^ /, '');

  switch (field) {
    case 'data':
      pending.data = pending.data !== undefined
        ? `${pending.data}\n${value}`
        : value;
      break;
    case 'id':
      pending.id = value;
      break;
    case 'event':
      pending.event = value;
      break;
    case 'retry': {
      const retry = parseInt(value, 10);
      if (!isNaN(retry)) pending.retry = retry;
      break;
    }
  }

  return { event: null, pending };
}

export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
): AsyncGenerator<SSEEvent> {
  const decoder = new TextDecoder();
  let buffer = '';
  let pending: Partial<SSEEvent> = {};

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const result = parseSSELine(line, pending);
      pending = result.pending;
      if (result.event) {
        yield result.event;
      }
    }
  }

  if (buffer.length > 0) {
    const result = parseSSELine(buffer, pending);
    if (result.event) yield result.event;
  }
}
```

**Key detail:** Multi-line `data:` fields are joined with `\n`. Empty lines delimit events. Comment lines (starting with `:`) are ignored (used for keepalive).

### Module: `client.ts` — SSE Client Transport

```typescript
import type {
  PenTransport,
  PenStreamRequest,
  PenStreamPart,
  Unsubscribe,
} from '@pen/types';
import type { SSEClientOptions } from './types.js';
import { parseSSEStream } from './parser.js';

export function sseTransport(options: SSEClientOptions): PenTransport {
  const {
    url,
    headers = {},
    reconnect: enableReconnect = true,
    reconnectDelay = 1000,
    maxReconnectAttempts = 5,
    pingTimeout = 30_000,
  } = options;

  let isConnected = false;
  let activeAbort: AbortController | null = null;
  const connectionListeners = new Set<(connected: boolean) => void>();

  function setConnected(value: boolean): void {
    if (isConnected === value) return;
    isConnected = value;
    for (const cb of connectionListeners) cb(value);
  }

  const transport: PenTransport = {
    async *stream(request: PenStreamRequest): AsyncIterable<PenStreamPart> {
      activeAbort = new AbortController();
      const signal = options.signal
        ? composeAbortSignals(options.signal, activeAbort.signal)
        : activeAbort.signal;

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
            ...headers,
          },
          body: JSON.stringify(request),
          signal,
        });

        if (!response.ok) {
          yield {
            type: 'error',
            errorText: `SSE request failed: ${response.status} ${response.statusText}`,
            code: `HTTP_${response.status}`,
          } as PenStreamPart;
          return;
        }

        if (!response.body) {
          yield {
            type: 'error',
            errorText: 'SSE response has no body',
            code: 'NO_BODY',
          } as PenStreamPart;
          return;
        }

        setConnected(true);
        let lastEventId: string | undefined;
        let pingTimer: ReturnType<typeof setTimeout> | null = null;

        const resetPingTimer = (): void => {
          if (pingTimer) clearTimeout(pingTimer);
          pingTimer = setTimeout(() => {
            setConnected(false);
          }, pingTimeout);
        };
        resetPingTimer();

        const reader = response.body.getReader();
        try {
          for await (const sseEvent of parseSSEStream(reader)) {
            resetPingTimer();

            if (sseEvent.id) lastEventId = sseEvent.id;

            const part = JSON.parse(sseEvent.data) as PenStreamPart;

            if (part.type === 'ping') continue;

            yield part;

            if (part.type === 'done' || part.type === 'error') break;
          }
        } finally {
          if (pingTimer) clearTimeout(pingTimer);
          reader.releaseLock();
        }
      } catch (error) {
        if (signal.aborted) return;
        setConnected(false);

        yield {
          type: 'error',
          errorText: error instanceof Error ? error.message : String(error),
          code: 'NETWORK_ERROR',
        } as PenStreamPart;
      } finally {
        activeAbort = null;
      }
    },

    async *reconnect(streamId: string): AsyncIterable<PenStreamPart> {
      let attempts = 0;

      while (attempts < maxReconnectAttempts) {
        attempts++;

        try {
          const response = await fetch(url, {
            method: 'GET',
            headers: {
              Accept: 'text/event-stream',
              'Last-Event-ID': streamId,
              ...headers,
            },
          });

          if (response.status === 501) {
            yield {
              type: 'error',
              errorText: 'Replay unsupported by transport, start a fresh stream',
              code: 'REPLAY_UNSUPPORTED',
            } as PenStreamPart;
            return;
          }

          if (!response.ok || !response.body) {
            await delay(reconnectDelay * attempts);
            continue;
          }

          setConnected(true);
          const reader = response.body.getReader();

          try {
            for await (const sseEvent of parseSSEStream(reader)) {
              const part = JSON.parse(sseEvent.data) as PenStreamPart;
              if (part.type === 'ping') continue;
              yield part;
              if (part.type === 'done' || part.type === 'error') return;
            }
          } finally {
            reader.releaseLock();
          }
          return;
        } catch {
          setConnected(false);
          await delay(reconnectDelay * attempts);
        }
      }

      yield {
        type: 'error',
        errorText: `Reconnection failed after ${maxReconnectAttempts} attempts`,
        code: 'RECONNECT_EXHAUSTED',
      } as PenStreamPart;
    },

    async connect(): Promise<void> {
      try {
        const response = await fetch(url, {
          method: 'HEAD',
          headers,
        });
        setConnected(response.ok);
      } catch {
        setConnected(false);
      }
    },

    async disconnect(): Promise<void> {
      activeAbort?.abort();
      activeAbort = null;
      setConnected(false);
    },

    get connected(): boolean {
      return isConnected;
    },

    onConnectionChange(callback: (connected: boolean) => void): Unsubscribe {
      connectionListeners.add(callback);
      return () => connectionListeners.delete(callback);
    },
  };

  return transport;
}

function composeAbortSignals(
  ...signals: AbortSignal[]
): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener('abort', () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
```

**Key design decisions:**

- **`fetch`-based, not `EventSource`.** The native `EventSource` API only supports GET requests. Pen needs POST for `PenStreamRequest` bodies. Using `fetch` with `ReadableStream` gives full control over method, headers, and body.
- **Ping timeout.** The client tracks time since last SSE event. If `pingTimeout` elapses (default 30s), connection state is set to `false`. The server should send `ping` parts more frequently than this threshold.
- **Reconnect with linear backoff.** `reconnect()` uses linear backoff (`delay * attempts`). Replay is optional in M0: the client sends `Last-Event-ID`, and servers that do not support replay return `501` so the client can fall back to a fresh stream.
- **Abort signal composition.** If the consumer passes an external `AbortSignal` (e.g., from React cleanup), it is composed with the internal abort controller. Either signal can cancel the stream.
- **`ping` parts are consumed, not yielded.** They reset the ping timer but are never exposed to the consumer.

### Module: `server.ts` — SSE Server Handler

Framework-agnostic request handler factory. Returns a function that accepts a `Request` and returns a `Response` — compatible with Node.js, Express, Hono, Deno, Bun, and Web Workers.

```typescript
import type {
  PenStreamRequest,
  PenStreamPart,
  ToolServer,
  Editor,
} from '@pen/types';
import type { SSEServerOptions } from './types.js';

export function createSSEHandler(
  options: SSEServerOptions,
): (request: Request) => Response | Promise<Response> {
  const {
    toolServer,
    editor,
    onRequest,
    onError,
    pingInterval = 15_000,
  } = options;

  const streamHistories = new Map<string, Array<{ id: string; data: string }>>();

  return async (request: Request): Promise<Response> => {
    if (request.method === 'GET') {
      return handleReconnect(request, options);
    }

    const body = await request.json() as PenStreamRequest;
    onRequest?.(body);

    const streamId = crypto.randomUUID();
    let eventIndex = 0;

    // eventHistory is referenced by the closure but must be accessible to handleReconnect.
    // The factory function maintains a shared streamHistories Map (see errata #8).
    const history: Array<{ id: string; data: string }> = [];
    streamHistories.set(streamId, history);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        let pingTimer: ReturnType<typeof setInterval> | null = null;

        const send = (part: PenStreamPart): void => {
          const id = `${streamId}:${eventIndex++}`;
          const data = JSON.stringify(part);

          history.push({ id, data });
          if (history.length > 1000) history.shift();

          const event = `id: ${id}\ndata: ${data}\n\n`;
          controller.enqueue(encoder.encode(event));
        };

        const sendPing = (): void => {
          send({ type: 'ping' } as PenStreamPart);
        };

        try {
          pingTimer = setInterval(sendPing, pingInterval);

          if (toolServer && body.toolCalls) {
            for (const toolCall of body.toolCalls) {
              const result = toolServer.executeTool(
                toolCall.name,
                toolCall.input,
                { toolCallId: toolCall.toolCallId, ...body.context },
              );

              if (isAsyncIterable(result)) {
                for await (const part of result) {
                  send(part as PenStreamPart);
                }
              } else {
                const resolved = await result;
                send({
                  type: 'tool-output',
                  toolCallId: toolCall.toolCallId,
                  output: resolved,
                } as PenStreamPart);
              }
            }
          }

          send({ type: 'done' } as PenStreamPart);
        } catch (error) {
          onError?.(error);
          send({
            type: 'error',
            errorText: error instanceof Error ? error.message : String(error),
          } as PenStreamPart);
        } finally {
          if (pingTimer) clearInterval(pingTimer);
          controller.close();
        }
      },
    });

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Stream-Id': streamId,
      },
    });
  };
}

async function handleReconnect(
  request: Request,
  _options: SSEServerOptions,
): Promise<Response> {
  const lastEventId = request.headers.get('Last-Event-ID');
  if (!lastEventId) {
    return new Response('Missing Last-Event-ID', { status: 400 });
  }

  // M0 contract: reconnect endpoint is optional.
  // If replay is unsupported, return 501 explicitly and let the
  // client restart a fresh stream. Missed deltas are recovered by
  // the CRDT merge path, not by SSE replay guarantees.
  return new Response('Replay not supported for this transport', {
    status: 501,
    headers: { 'X-Replay-Supported': 'false' },
  });
}

function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    value != null &&
    typeof value === 'object' &&
    Symbol.asyncIterator in (value as object)
  );
}
```

**Key design decisions:**

- **Web-standard `Request`/`Response`.** Works everywhere — no Express/Hono coupling. Framework adapters are trivial (Express: `(req, res) => handler(toRequest(req)).then(fromResponse(res))`).
- **`X-Stream-Id` header.** Returned to the client for use in `reconnect()`.
- **Monotonic event IDs.** Format: `{streamId}:{eventIndex}`. Globally unique per stream. The client sends this as `Last-Event-ID` on reconnection.
- **Ping interval.** Server sends `ping` parts every 15s (configurable). The client's `pingTimeout` (default 30s) should be at least 2x this value.
- **Event history buffer.** Capped at 1000 events in-memory. For M0 this covers brief reconnections. Production deployments should use external storage.
- **Replay capability is explicit.** M0 does not require replay support. If unsupported, reconnect returns `501` + `X-Replay-Supported: false`, and clients must fall back to a fresh stream.

### Module: `index.ts`

```typescript
export { sseTransport } from './client.js';
export { createSSEHandler } from './server.js';
export type { SSEClientOptions, SSEServerOptions, SSEEvent } from './types.js';
```

### Dependencies

None beyond `@pen/core`. Uses native `fetch`, `ReadableStream`, `TextDecoder`, `TextEncoder`, `crypto.randomUUID()` — all available in modern runtimes (Node 18+, Deno, Bun, browsers).

---

## Shared Importer Utilities

Both `@pen/import-markdown` and `@pen/import-html` share the same `blocksToOps` conversion function and `PendingBlock` type. These live in `@pen/core` alongside other runtime utilities (not in `@pen/types`, which has zero runtime dependencies):

```typescript
// packages/core/src/importer-utils.ts

export interface PendingBlock {
  type: string;
  props: Record<string, unknown>;
  content?: string;
  marks?: Array<{ type: string; props?: Record<string, unknown>; start: number; end: number }>;
  children?: PendingBlock[];
}
```

The `blocksToOps(blocks: PendingBlock[], options?: ImportOptions): DocumentOp[]` function is defined once and imported by both importers. It converts pending blocks to `insert-block`, `insert-text`, and `format-text` ops using the pattern documented in `@pen/import-markdown`'s `importer.ts`.

`blocksToOps` MUST materialize table blocks end-to-end. For `table` pending blocks, it writes `tableContent` as a `Y.Array` of row `Y.Map`s with cell `Y.Text` values (including marks), then emits the corresponding table insert/update ops in the same batch. Skipping `__table_row` / `__table_cell` placeholders is valid only after they have been folded into `tableContent`.

---

## Package 3: `@pen/import-markdown`

Markdown importer (Spec Section 15.1). Used by the paste pipeline and `write_document` tool.

### File Structure

```
packages/extensions/import-markdown/src/
├── importer.ts             Importer<string> implementation
├── ast-to-blocks.ts        mdast AST → Pen block conversion
├── inline-marks.ts         mdast inline nodes → Y.Text mark attributes
├── table-parser.ts         GFM table → Pen table block conversion
├── types.ts                Internal AST mapping types
└── index.ts                Package entry
```

### Import DAG

```
types.ts          ← (no imports)
inline-marks.ts   ← types.ts, (@pen/core)
table-parser.ts   ← types.ts, (@pen/core)
ast-to-blocks.ts  ← types.ts, inline-marks.ts, table-parser.ts, (@pen/core)
importer.ts       ← ast-to-blocks.ts, (@pen/core)
index.ts          ← importer.ts
```

No cycles.

### Module: `types.ts`

```typescript
import type { PendingBlock } from '@pen/core';

export interface InlineMark {
  type: string;
  props?: Record<string, unknown>;
  start: number;
  end: number;
}

export interface BlockMapping {
  mdastType: string;
  blockType: string;
  propsFromNode?: (node: unknown) => Record<string, unknown>;
}
```

`PendingBlock` is imported from `@pen/core/importer-utils.ts` (shared across all importers). `InlineMark` and `BlockMapping` are markdown-importer-specific.

### Module: `inline-marks.ts`

Maps mdast inline nodes to Pen inline mark attributes. These are the formatting annotations applied to `Y.Text` via the `marks` parameter of `insert-text` ops.

```typescript
import type { InlineMark } from './types.js';

interface InlineContext {
  text: string;
  marks: InlineMark[];
  offset: number;
}

export function processInlineNodes(
  nodes: MdastNode[],
  ctx: InlineContext,
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        ctx.text += node.value;
        ctx.offset += node.value.length;
        break;

      case 'strong': {
        const start = ctx.offset;
        processInlineNodes(node.children, ctx);
        ctx.marks.push({ type: 'bold', start, end: ctx.offset });
        break;
      }

      case 'emphasis': {
        const start = ctx.offset;
        processInlineNodes(node.children, ctx);
        ctx.marks.push({ type: 'italic', start, end: ctx.offset });
        break;
      }

      case 'delete': {
        const start = ctx.offset;
        processInlineNodes(node.children, ctx);
        ctx.marks.push({ type: 'strikethrough', start, end: ctx.offset });
        break;
      }

      case 'inlineCode':
        ctx.marks.push({
          type: 'code',
          start: ctx.offset,
          end: ctx.offset + node.value.length,
        });
        ctx.text += node.value;
        ctx.offset += node.value.length;
        break;

      case 'link': {
        const start = ctx.offset;
        processInlineNodes(node.children, ctx);
        ctx.marks.push({
          type: 'link',
          props: { href: node.url, title: node.title ?? undefined },
          start,
          end: ctx.offset,
        });
        break;
      }

      case 'image':
        // Inline images are treated as text placeholders.
        // Block-level images are handled in ast-to-blocks.ts.
        ctx.text += node.alt ?? '';
        ctx.offset += (node.alt ?? '').length;
        break;

      case 'html':
        // Raw HTML inline — strip tags, keep text
        ctx.text += stripHTMLTags(node.value);
        ctx.offset += stripHTMLTags(node.value).length;
        break;

      default:
        if ('children' in node && Array.isArray(node.children)) {
          processInlineNodes(node.children, ctx);
        } else if ('value' in node && typeof node.value === 'string') {
          ctx.text += node.value;
          ctx.offset += node.value.length;
        }
        break;
    }
  }
}

function stripHTMLTags(html: string): string {
  return html.replace(/<[^>]*>/g, '');
}
```

**Mark nesting:** Marks are collected as ranges (`start`/`end` offsets) relative to the block's text content. When flushing to `editor.apply()`, overlapping ranges produce the correct Y.Text attribute structure. The importer does not need to nest marks explicitly — Yjs handles overlapping attributes.

### Module: `table-parser.ts`

GFM pipe table parsing. Converts mdast `table` nodes into Pen's table block format.

```typescript
import type { PendingBlock, InlineMark } from './types.js';
import { processInlineNodes } from './inline-marks.js';

export function parseTable(tableNode: MdastTable): PendingBlock {
  const hasHeaderRow = tableNode.children.length > 0 &&
    tableNode.children[0]?.type === 'tableRow';

  const rows: Array<Array<{ text: string; marks: InlineMark[] }>> = [];

  for (const row of tableNode.children) {
    const cells: Array<{ text: string; marks: InlineMark[] }> = [];
    for (const cell of row.children) {
      const ctx = { text: '', marks: [] as InlineMark[], offset: 0 };
      processInlineNodes(cell.children, ctx);
      cells.push({ text: ctx.text, marks: ctx.marks });
    }
    rows.push(cells);
  }

  return {
    type: 'table',
    props: {
      hasHeaderRow,
      hasHeaderColumn: false,
    },
    content: undefined,
    children: rows.map((row, rowIndex) => ({
      type: '__table_row',
      props: { _rowIndex: rowIndex },
      children: row.map((cell, colIndex) => ({
        type: '__table_cell',
        props: { _rowIndex: rowIndex, _colIndex: colIndex },
        content: cell.text,
        marks: cell.marks,
      })),
    })),
  };
}
```

**Note:** `__table_row` and `__table_cell` are internal intermediate types. The `ast-to-blocks.ts` module translates these into the correct CRDT table structure (`tableContent` Y.Array of Y.Map rows, each containing cell Y.Text instances) when flushing to the editor.

### Module: `ast-to-blocks.ts`

The core conversion pipeline. Walks the mdast AST top-down and produces `PendingBlock` arrays.

```typescript
import type { PendingBlock, InlineMark } from './types.js';
import { processInlineNodes } from './inline-marks.js';
import { parseTable } from './table-parser.js';
import type { SchemaRegistry } from '@pen/types';

const BLOCK_MAPPINGS: Record<string, (node: any) => PendingBlock | null> = {
  heading: (node) => ({
    type: 'heading',
    props: { level: node.depth ?? 1 },
    content: '',
    marks: [],
  }),

  paragraph: (_node) => ({
    type: 'paragraph',
    props: {},
    content: '',
    marks: [],
  }),

  blockquote: (_node) => ({
    type: 'blockquote',
    props: {},
    content: '',
    marks: [],
  }),

  code: (node) => ({
    type: 'codeBlock',
    props: { language: node.lang ?? undefined },
    content: node.value ?? '',
    marks: [],
  }),

  thematicBreak: (_node) => ({
    type: 'divider',
    props: {},
  }),

  image: (node) => ({
    type: 'image',
    props: {
      src: node.url ?? '',
      alt: node.alt ?? undefined,
      caption: node.title ?? undefined,
    },
  }),

  table: (node) => parseTable(node),
};

export function astToBlocks(
  root: MdastRoot,
  registry: SchemaRegistry,
): PendingBlock[] {
  const blocks: PendingBlock[] = [];
  walkNodes(root.children, blocks, registry, 0);
  return blocks;
}

function walkNodes(
  nodes: MdastNode[],
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  listIndent: number,
): void {
  for (const node of nodes) {
    const mapping = BLOCK_MAPPINGS[node.type];
    if (mapping) {
      const block = mapping(node);
      if (!block) continue;

      if ('children' in node && block.type !== 'codeBlock' && block.type !== 'table') {
        const ctx = { text: '', marks: [] as InlineMark[], offset: 0 };
        processInlineNodes(node.children, ctx);
        block.content = ctx.text;
        block.marks = ctx.marks;
      }

      blocks.push(block);
      continue;
    }

    if (node.type === 'list') {
      walkListItems(node, blocks, registry, listIndent);
      continue;
    }

    if (node.type === 'listItem') {
      const block = listItemToBlock(node, listIndent);
      blocks.push(block);

      if (node.children) {
        for (const child of node.children) {
          if (child.type === 'list') {
            walkListItems(child, blocks, registry, listIndent + 1);
          }
        }
      }
      continue;
    }

    // Unrecognized block-level node → paragraph fallback
    if ('children' in node && Array.isArray(node.children)) {
      walkNodes(node.children, blocks, registry, listIndent);
    }
  }
}

function walkListItems(
  listNode: MdastList,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  indent: number,
): void {
  for (let i = 0; i < listNode.children.length; i++) {
    const item = listNode.children[i];
    const block = listItemToBlock(item, indent, listNode, i);
    blocks.push(block);

    for (const child of item.children ?? []) {
      if (child.type === 'list') {
        walkListItems(child, blocks, registry, indent + 1);
      }
    }
  }
}

function listItemToBlock(
  item: MdastListItem,
  indent: number,
  list?: MdastList,
  index?: number,
): PendingBlock {
  // Check list items
  if (item.checked !== undefined && item.checked !== null) {
    const ctx = { text: '', marks: [] as InlineMark[], offset: 0 };
    const inlineChildren = (item.children ?? []).filter(
      (c: any) => c.type !== 'list',
    );
    for (const child of inlineChildren) {
      if ('children' in child) {
        processInlineNodes(child.children, ctx);
      }
    }
    return {
      type: 'checkListItem',
      props: { indent, checked: item.checked },
      content: ctx.text,
      marks: ctx.marks,
    };
  }

  // Ordered list
  if (list?.ordered) {
    const ctx = { text: '', marks: [] as InlineMark[], offset: 0 };
    const inlineChildren = (item.children ?? []).filter(
      (c: any) => c.type !== 'list',
    );
    for (const child of inlineChildren) {
      if ('children' in child) {
        processInlineNodes(child.children, ctx);
      }
    }
    return {
      type: 'numberedListItem',
      props: {
        indent,
        start: index === 0 ? (list.start ?? 1) : undefined,
      },
      content: ctx.text,
      marks: ctx.marks,
    };
  }

  // Unordered list
  const ctx = { text: '', marks: [] as InlineMark[], offset: 0 };
  const inlineChildren = (item.children ?? []).filter(
    (c: any) => c.type !== 'list',
  );
  for (const child of inlineChildren) {
    if ('children' in child) {
      processInlineNodes(child.children, ctx);
    }
  }
  return {
    type: 'bulletListItem',
    props: { indent },
    content: ctx.text,
    marks: ctx.marks,
  };
}
```

`ast-to-blocks` is schema-first: for each node, resolve block schemas and call `schema.serialize.fromMarkdown(node)` when available; use `BLOCK_MAPPINGS` only as fallback behavior when no schema handler claims the node type.

**List handling:** Pen uses a flat list model (no wrapper block). Each list item becomes its own block with an `indent` prop. Nested lists increment `indent`. Numbered list items inherit `start` from their parent `list` node (only on the first item — subsequent items auto-increment).

### Module: `importer.ts`

```typescript
import type { Importer, ImportOptions, Editor, SchemaRegistry } from '@pen/types';
import { fromMarkdown } from 'mdast-util-from-markdown';
import { gfm } from 'micromark-extension-gfm';
import { gfmFromMarkdown } from 'mdast-util-gfm';
import { astToBlocks } from './ast-to-blocks.js';
import type { PendingBlock, InlineMark } from './types.js';

export const markdownImporter: Importer<string> = {
  name: 'markdown',
  mimeType: 'text/markdown',

  import(
    input: string,
    editor: Editor,
    options?: ImportOptions,
  ): void {
    const tree = fromMarkdown(input, {
      extensions: [gfm()],
      mdastExtensions: [gfmFromMarkdown()],
    });

    const registry = editor.schema;
    const blocks = astToBlocks(tree, registry);

    if (blocks.length === 0) return;

    const ops = blocksToOps(blocks, options);

    editor.apply(ops, { origin: 'import', undoGroup: true });
  },
};

function blocksToOps(
  blocks: PendingBlock[],
  options?: ImportOptions,
): import('@pen/core').DocumentOp[] {
  const ops: import('@pen/core').DocumentOp[] = [];
  let position: import('@pen/core').Position = options?.position ?? 'last';

  for (const block of blocks) {
    if (block.type.startsWith('__table')) continue;

    const blockId = crypto.randomUUID();

    ops.push({
      type: 'insert-block',
      blockId,
      blockType: block.type,
      props: cleanProps(block.props),
      position,
    });

    if (block.content) {
      // Insert plain text first, then apply marks as separate format-text ops.
      // The previous approach passed marks as a single flat attribute object on
      // insert-text, which collapsed overlapping ranges (e.g. bold [0-10] and
      // italic [3-7] would merge into { bold: true, italic: true } for the
      // entire text, applying both marks everywhere instead of at their
      // correct ranges).
      ops.push({
        type: 'insert-text',
        blockId,
        offset: 0,
        text: block.content,
      });

      for (const mark of block.marks ?? []) {
        if (mark.start >= mark.end) continue;
        ops.push({
          type: 'format-text',
          blockId,
          offset: mark.start,
          length: mark.end - mark.start,
          marks: { [mark.type]: mark.props ?? true },
        });
      }
    }

    position = { after: blockId };
  }

  return ops;
}

function cleanProps(props: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned;
}
```

**Key design decisions:**

- **`mdast-util-from-markdown` + `micromark-extension-gfm`.** CommonMark core with GFM extensions (tables, strikethrough, task lists). The mdast ecosystem is the standard for Markdown AST manipulation — extensible, well-tested, tree-sitter-quality parsing.
- **Single `editor.apply()` batch.** All ops from a single import are applied in one call with `undoGroup: true`. This creates a single undo entry for the entire import.
- **`origin: 'import'`.** Import operations are attributed to the importer, not the user. This keeps the undo stack clean — the user's manual edits and imported content are separate undo groups.
- **Mark-to-op mapping.** Inline marks are collected as offset ranges during AST walking, then emitted as individual `format-text` ops after the `insert-text` op. This correctly handles overlapping marks (e.g. bold over a full sentence with italic on one word) — each mark range gets its own `format-text` op targeting the exact offsets. The editor's `apply` pipeline executes these as `Y.Text.format()` calls.

### Module: `index.ts`

```typescript
export { markdownImporter } from './importer.js';
```

### Dependencies

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "mdast-util-from-markdown": "^2.0.0",
    "mdast-util-gfm": "^3.0.0",
    "micromark-extension-gfm": "^3.0.0"
  }
}
```

---

## Package 4: `@pen/import-html`

HTML importer with sanitization (Spec Section 15.1, 5.9). Used by the paste pipeline.

### File Structure

```
packages/extensions/import-html/src/
├── importer.ts             Importer<string> implementation
├── sanitize.ts             HTML sanitization (BEFORE any DOM walking)
├── dom-to-blocks.ts        DOM element → Pen block conversion
├── inline-parser.ts        Inline element → mark attribute mapping
├── dom-adapter.ts          DOMParser abstraction (browser vs server)
└── index.ts                Package entry
```

### Import DAG

```
dom-adapter.ts    ← (htmlparser2, domhandler)
sanitize.ts       ← (dompurify)
inline-parser.ts  ← (@pen/core)
dom-to-blocks.ts  ← inline-parser.ts, (@pen/core)
importer.ts       ← sanitize.ts, dom-to-blocks.ts, dom-adapter.ts, (@pen/core)
index.ts          ← importer.ts
```

No cycles.

### Module: `sanitize.ts`

**This is the security boundary.** All HTML input passes through sanitization before any processing. The sanitizer runs BEFORE DOM walking — `dom-to-blocks.ts` receives already-sanitized content.

```typescript
import DOMPurify from 'isomorphic-dompurify';

const PURIFY_CONFIG: DOMPurify.Config = {
  ALLOWED_TAGS: [
    'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'ul', 'ol', 'li',
    'a', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'strike',
    'code', 'pre', 'blockquote',
    'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'img', 'mark', 'span', 'div', 'details', 'summary',
    'input',
  ],
  ALLOWED_ATTR: [
    'href', 'src', 'alt', 'title', 'width', 'height',
    'class', 'id', 'colspan', 'rowspan',
    'type', 'checked', 'disabled',
    'data-*',
    'open',
  ],
  ALLOW_DATA_ATTR: true,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'applet', 'form', 'noscript', 'template', 'math', 'svg'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
};

export function sanitizeHTML(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG);
}
```

**Why DOMPurify instead of regex.** The previous approach used regex-based sanitization which is fundamentally fragile. HTML parsing with regex cannot handle:
- Attribute values containing `>` characters (e.g. `<img title="a>b" onerror=alert(1)>`)
- Mixed-case or unicode-encoded event handlers (`ONCLICK`, `\u006fnclick`)
- CSS `url()` injection in style attributes
- `data:` URI payloads with base64 encoding
- Self-closing tag edge cases

DOMPurify is the industry standard (used by WordPress, Google, Mozilla), battle-tested against thousands of XSS vectors, and actively maintained. It parses HTML into a real DOM tree before sanitizing, eliminating the regex bypass class entirely.

Inline style handling is allowlist-only. Importers may read `color` and `background-color` to produce `textColor` / `backgroundColor` marks; all other style properties MUST be stripped or ignored.

### Module: `dom-adapter.ts`

Abstracts DOM parsing for both browser and server (Node.js) environments.

```typescript
import { parseDocument } from 'htmlparser2';
import type { Document, Element, ChildNode } from 'domhandler';

export interface DOMNode {
  type: string;
  tagName?: string;
  textContent?: string;
  attributes?: Record<string, string>;
  children?: DOMNode[];
}

export function parseHTML(html: string): DOMNode {
  if (typeof globalThis.DOMParser !== 'undefined') {
    const doc = new globalThis.DOMParser().parseFromString(html, 'text/html');
    return domNodeToDOMNode(doc.body);
  }

  const doc = parseDocument(html);
  return htmlparser2ToDOMNode(doc);
}

function domNodeToDOMNode(node: globalThis.Node): DOMNode {
  const result: DOMNode = {
    type: node.nodeType === 1 ? 'element'
      : node.nodeType === 3 ? 'text'
      : 'other',
  };

  if (node.nodeType === 1) {
    const el = node as globalThis.Element;
    result.tagName = el.tagName.toLowerCase();
    result.attributes = {};
    for (const attr of el.attributes) {
      result.attributes[attr.name.toLowerCase()] = attr.value;
    }
  }

  if (node.nodeType === 3) {
    result.textContent = node.textContent ?? '';
  }

  if (node.childNodes.length > 0) {
    result.children = Array.from(node.childNodes).map(domNodeToDOMNode);
  }

  return result;
}

function htmlparser2ToDOMNode(node: Document | ChildNode): DOMNode {
  if (node.type === 'text') {
    return { type: 'text', textContent: 'data' in node ? String(node.data) : '' };
  }

  if (node.type === 'tag' || node.type === 'script' || node.type === 'style') {
    const el = node as Element;
    return {
      type: 'element',
      tagName: el.name.toLowerCase(),
      attributes: el.attribs ?? {},
      children: el.children?.map(htmlparser2ToDOMNode),
    };
  }

  if ('children' in node && Array.isArray(node.children)) {
    return {
      type: 'root',
      children: node.children.map(htmlparser2ToDOMNode),
    };
  }

  return { type: 'other' };
}
```

**Browser vs Node.js:** In the browser, `DOMParser` is used (native, fast, well-tested). On the server (Node.js), `htmlparser2` provides a lightweight DOM tree without JSDOM overhead.

### Module: `inline-parser.ts`

```typescript
import type { DOMNode } from './dom-adapter.js';

interface InlineResult {
  text: string;
  marks: Array<{ type: string; props?: Record<string, unknown>; start: number; end: number }>;
}

const INLINE_MARK_MAP: Record<string, string> = {
  strong: 'bold',
  b: 'bold',
  em: 'italic',
  i: 'italic',
  u: 'underline',
  s: 'strikethrough',
  del: 'strikethrough',
  strike: 'strikethrough',
  code: 'code',
  mark: 'highlight',
};

export function parseInlineContent(node: DOMNode): InlineResult {
  const result: InlineResult = { text: '', marks: [] };
  walkInline(node, result);
  return result;
}

function walkInline(node: DOMNode, result: InlineResult): void {
  if (node.type === 'text') {
    result.text += node.textContent ?? '';
    return;
  }

  if (node.type !== 'element' || !node.tagName) {
    for (const child of node.children ?? []) walkInline(child, result);
    return;
  }

  const markType = INLINE_MARK_MAP[node.tagName];
  if (markType) {
    const start = result.text.length;
    for (const child of node.children ?? []) walkInline(child, result);
    result.marks.push({ type: markType, start, end: result.text.length });
    return;
  }

  if (node.tagName === 'a') {
    const start = result.text.length;
    for (const child of node.children ?? []) walkInline(child, result);
    result.marks.push({
      type: 'link',
      props: {
        href: node.attributes?.href ?? '',
        title: node.attributes?.title ?? undefined,
      },
      start,
      end: result.text.length,
    });
    return;
  }

  if (node.tagName === 'span') {
    const style = node.attributes?.style ?? '';
    const colorMatch = style.match(/(?:^|;)\s*color\s*:\s*([^;]+)/i);
    const bgMatch = style.match(/(?:^|;)\s*background(?:-color)?\s*:\s*([^;]+)/i);

    const start = result.text.length;
    for (const child of node.children ?? []) walkInline(child, result);
    const end = result.text.length;

    if (colorMatch) {
      result.marks.push({ type: 'textColor', props: { color: colorMatch[1].trim() }, start, end });
    }
    if (bgMatch) {
      result.marks.push({ type: 'backgroundColor', props: { color: bgMatch[1].trim() }, start, end });
    }
    return;
  }

  if (node.tagName === 'br') {
    result.text += '\n';
    return;
  }

  for (const child of node.children ?? []) walkInline(child, result);
}
```

### Module: `dom-to-blocks.ts`

```typescript
import type { DOMNode } from './dom-adapter.js';
import { parseInlineContent } from './inline-parser.js';
import type { SchemaRegistry } from '@pen/types';

interface PendingBlock {
  type: string;
  props: Record<string, unknown>;
  content?: string;
  marks?: Array<{ type: string; props?: Record<string, unknown>; start: number; end: number }>;
}

const BLOCK_ELEMENT_MAP: Record<string, (node: DOMNode) => PendingBlock> = {
  h1: (node) => blockWithInline('heading', { level: 1 }, node),
  h2: (node) => blockWithInline('heading', { level: 2 }, node),
  h3: (node) => blockWithInline('heading', { level: 3 }, node),
  h4: (node) => blockWithInline('heading', { level: 4 }, node),
  h5: (node) => blockWithInline('heading', { level: 5 }, node),
  h6: (node) => blockWithInline('heading', { level: 6 }, node),
  p: (node) => blockWithInline('paragraph', {}, node),
  blockquote: (node) => blockWithInline('blockquote', {}, node),
  hr: () => ({ type: 'divider', props: {} }),
  pre: (node) => {
    const codeNode = node.children?.find(c => c.tagName === 'code');
    const langClass = codeNode?.attributes?.class ?? '';
    const langMatch = langClass.match(/language-(\S+)/);
    const text = extractText(codeNode ?? node);
    return {
      type: 'codeBlock',
      props: { language: langMatch?.[1] ?? undefined },
      content: text,
    };
  },
  img: (node) => ({
    type: 'image',
    props: {
      src: node.attributes?.src ?? '',
      alt: node.attributes?.alt ?? undefined,
      caption: node.attributes?.title ?? undefined,
    },
  }),
};

export function domToBlocks(
  root: DOMNode,
  registry: SchemaRegistry,
): PendingBlock[] {
  const blocks: PendingBlock[] = [];
  walkElements(root, blocks, registry);
  return blocks;
}

function walkElements(
  node: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
): void {
  if (node.type === 'text') {
    const text = (node.textContent ?? '').trim();
    if (text) {
      blocks.push({ type: 'paragraph', props: {}, content: text });
    }
    return;
  }

  if (node.type !== 'element' || !node.tagName) {
    for (const child of node.children ?? []) {
      walkElements(child, blocks, registry);
    }
    return;
  }

  const handler = BLOCK_ELEMENT_MAP[node.tagName];
  if (handler) {
    blocks.push(handler(node));
    return;
  }

  // Lists
  if (node.tagName === 'ul' || node.tagName === 'ol') {
    walkList(node, blocks, registry, 0, node.tagName === 'ol');
    return;
  }

  // Table
  if (node.tagName === 'table') {
    blocks.push(parseHTMLTable(node));
    return;
  }

  // Block-level container (div, section, article, main, aside, etc.)
  if (isBlockElement(node.tagName)) {
    for (const child of node.children ?? []) {
      walkElements(child, blocks, registry);
    }
    return;
  }

  // Inline-only element at block level → wrap in paragraph
  const inline = parseInlineContent(node);
  if (inline.text.trim()) {
    blocks.push({
      type: 'paragraph',
      props: {},
      content: inline.text,
      marks: inline.marks,
    });
  }
}

function walkList(
  node: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  indent: number,
  ordered: boolean,
): void {
  const items = (node.children ?? []).filter(c => c.tagName === 'li');

  for (let i = 0; i < items.length; i++) {
    const li = items[i];

    // Check for checkbox (task list)
    const checkbox = li.children?.find(
      c => c.tagName === 'input' && c.attributes?.type === 'checkbox',
    );

    const inlineChildren = (li.children ?? []).filter(
      c => c.tagName !== 'ul' && c.tagName !== 'ol' &&
           !(c.tagName === 'input' && c.attributes?.type === 'checkbox'),
    );
    const inline = parseInlineContent({ type: 'element', tagName: 'span', children: inlineChildren });

    if (checkbox) {
      blocks.push({
        type: 'checkListItem',
        props: {
          indent,
          checked: checkbox.attributes?.checked !== undefined,
        },
        content: inline.text,
        marks: inline.marks,
      });
    } else if (ordered) {
      blocks.push({
        type: 'numberedListItem',
        props: { indent },
        content: inline.text,
        marks: inline.marks,
      });
    } else {
      blocks.push({
        type: 'bulletListItem',
        props: { indent },
        content: inline.text,
        marks: inline.marks,
      });
    }

    // Nested lists
    for (const child of li.children ?? []) {
      if (child.tagName === 'ul' || child.tagName === 'ol') {
        walkList(child, blocks, registry, indent + 1, child.tagName === 'ol');
      }
    }
  }
}

function parseHTMLTable(node: DOMNode): PendingBlock {
  const hasHeaderRow = (node.children ?? []).some(c => c.tagName === 'thead');

  // M0: Table cell content parsing produces full PendingBlock children
  // with __table_row / __table_cell intermediate types, matching the
  // markdown importer's table format. blocksToOps materializes these
  // into the CRDT tableContent structure.
  const rows: PendingBlock[] = [];
  const allRows = collectTableRows(node);
  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const row = allRows[rowIdx];
    const cells: PendingBlock[] = [];
    const cellNodes = (row.children ?? []).filter(c => c.tagName === 'td' || c.tagName === 'th');
    for (let colIdx = 0; colIdx < cellNodes.length; colIdx++) {
      const inline = parseInlineContent(cellNodes[colIdx]);
      cells.push({
        type: '__table_cell',
        props: { _rowIndex: rowIdx, _colIndex: colIdx },
        content: inline.text,
        marks: inline.marks,
      });
    }
    rows.push({
      type: '__table_row',
      props: { _rowIndex: rowIdx },
      children: cells,
    });
  }

  return {
    type: 'table',
    props: { hasHeaderRow, hasHeaderColumn: false },
    children: rows,
  };
}

function collectTableRows(tableNode: DOMNode): DOMNode[] {
  const rows: DOMNode[] = [];
  for (const child of tableNode.children ?? []) {
    if (child.tagName === 'tr') {
      rows.push(child);
    } else if (child.tagName === 'thead' || child.tagName === 'tbody' || child.tagName === 'tfoot') {
      for (const row of child.children ?? []) {
        if (row.tagName === 'tr') rows.push(row);
      }
    }
  }
  return rows;
}

function blockWithInline(
  type: string,
  props: Record<string, unknown>,
  node: DOMNode,
): PendingBlock {
  const inline = parseInlineContent(node);
  return { type, props, content: inline.text, marks: inline.marks };
}

function extractText(node: DOMNode): string {
  if (node.type === 'text') return node.textContent ?? '';
  return (node.children ?? []).map(extractText).join('');
}

const BLOCK_ELEMENTS = new Set([
  'div', 'section', 'article', 'main', 'aside', 'header',
  'footer', 'nav', 'figure', 'figcaption', 'details', 'summary',
  'fieldset', 'legend', 'address', 'hgroup',
]);

function isBlockElement(tagName: string): boolean {
  return BLOCK_ELEMENTS.has(tagName);
}
```

`dom-to-blocks` is schema-first: each element should first attempt `schema.serialize.fromHTML(element)` for matching block schemas. `BLOCK_ELEMENT_MAP` is a fallback mapping for common HTML tags when no schema handler is provided.

### Module: `importer.ts`

```typescript
import type { Importer, ImportOptions, Editor } from '@pen/types';
import { sanitizeHTML } from './sanitize.js';
import { parseHTML } from './dom-adapter.js';
import { domToBlocks } from './dom-to-blocks.js';

export const htmlImporter: Importer<string> = {
  name: 'html',
  mimeType: 'text/html',

  async import(
    input: string,
    editor: Editor,
    options?: ImportOptions,
  ): Promise<void> {
    // Step 1: Sanitize BEFORE any DOM parsing
    const sanitized = sanitizeHTML(input);

    // Step 2: Parse to DOM tree
    const dom = parseHTML(sanitized);

    // Step 3: Convert DOM → PendingBlocks
    const registry = editor.schema;
    const blocks = domToBlocks(dom, registry);

    if (blocks.length === 0) return;

    // Step 4: Generate ops and apply as single undo group
    const { blocksToOps } = await import('@pen/core');
    const ops = blocksToOps(blocks, options);
    editor.apply(ops, { origin: 'import', undoGroup: true });
  },
};
```

### Module: `index.ts`

```typescript
export { htmlImporter } from './importer.js';
export { sanitizeHTML } from './sanitize.js';
```

`sanitizeHTML` is exported for consumers who need standalone sanitization (e.g., rendering user-generated HTML outside the import pipeline).

### Dependencies

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "htmlparser2": "^9.0.0",
    "domhandler": "^5.0.0",
    "isomorphic-dompurify": "^2.0.0"
  }
}
```

`htmlparser2` and `domhandler` are server-side only — they're used when `globalThis.DOMParser` is unavailable. In browser environments, the native `DOMParser` is used (zero additional bundle size). `isomorphic-dompurify` wraps DOMPurify and handles the browser/server split internally (uses `jsdom` on the server automatically), eliminating the need for manual environment detection.

---

## Key Decisions

1. **Transport is consumer-facing.** The transport connects the client editor to the stream source (server or in-process tool server). It does NOT handle CRDT sync — that's the sync extension's job (M1).

2. **`fetch`-based SSE, not `EventSource`.** The native `EventSource` API only supports GET requests. Pen needs POST for `PenStreamRequest` bodies. Using `fetch` with `ReadableStream` gives full control.

3. **Importers write via `editor.apply()`.** They don't touch the CRDT directly. This ensures schema validation, normalization, and undo grouping.

4. **HTML sanitization uses isomorphic-dompurify.** A wrapper around the industry-standard DOMPurify that handles the browser/server split internally. Parses HTML into a real DOM tree, eliminating the class of regex bypass vulnerabilities. Runs before our DOM walking pipeline receives the content.

5. **Markdown parser uses the mdast ecosystem.** `mdast-util-from-markdown` + `micromark-extension-gfm` for extensibility. Consumers can add custom syntax extensions via the same mdast plugin system.

6. **Flat list model.** Both importers produce flat list items with `indent` props, matching Pen's block model (no wrapper blocks). Nested HTML/Markdown lists increment `indent`.

7. **Server handler uses Web `Request`/`Response`.** Framework-agnostic — no Express/Hono/Koa dependency. Adapters are trivial one-liners.

8. **SSE reconnect is capability-based in M0.** Clients always send `Last-Event-ID`; servers may return replayed events or `501` (`X-Replay-Supported: false`) to signal fresh-stream fallback. CRDT sync provides eventual consistency.

9. **DOM adapter auto-selects.** Browser environments use native `DOMParser` (zero bundle cost). Server environments use `htmlparser2` (lightweight, fast, no JSDOM overhead).

10. **Exporters are symmetric with importers.** `@pen/export-markdown` and `@pen/export-html` implement the `Exporter` interface from `@pen/core`. They read block handles, call `serialize.toMarkdown()` / `serialize.toHTML()` from each block's schema, and join with the correct markup. This closes the round-trip: import → edit → export. List items are grouped by consecutive runs of the same indent level. Inline marks use `sortDeltaAttributes()` for consistent ordering.

11. **Serialization code must use `BlockHandle` API, not raw CRDT types.** Exporters that need formatted inline content must use `handle.textDeltas()` (a CRDT-agnostic array of `{ insert, attributes? }` segments) instead of casting to `Y.Text` and calling `.toDelta()` directly. This preserves the CRDT adapter abstraction and ensures compatibility with future Loro adapter (Wave 12). The only exception is the SSE transport's sync layer, which is a `raw()` blast-radius module by design.

---

## Package 5: `@pen/export-markdown` (New)

Markdown exporter. Implements `Exporter` from `@pen/core`.

### File Structure

```
packages/extensions/export-markdown/src/
├── exporter.ts      Exporter implementation
├── list-grouper.ts  Groups consecutive list items into markdown lists
└── index.ts         Package entry
```

### Module: `exporter.ts`

```typescript
import type { Exporter, ExportOptions, Editor, BlockHandle } from '@pen/types';
import { sortDeltaAttributes } from '@pen/core';

export const markdownExporter: Exporter<string> = {
  name: 'markdown',
  mimeType: 'text/markdown',

  export(editor: Editor, options?: ExportOptions): string {
    const lines: string[] = [];
    const blockOrder = editor.documentState.blockOrder;

    for (const blockId of blockOrder) {
      const handle = editor.getBlock(blockId);
      if (!handle) continue;

      const schema = editor.schema.resolve(handle.type);
      if (!schema?.serialize?.toMarkdown) {
        lines.push(handle.textContent());
        continue;
      }

      const block = {
        id: handle.id,
        type: handle.type,
        props: handle.props,
        content: serializeInlineContent(handle, editor),
      };

      lines.push(schema.serialize.toMarkdown(block));
    }

    return lines.join('\n\n');
  },
};

> **TODO (implementation):** Replace direct `Y.Text.toDelta()` access with `BlockHandle.textDeltas()`. The spec shows raw CRDT access for clarity; the implementation must use the handle API.

function serializeInlineContent(handle: BlockHandle, editor: Editor): string {
  const doc = editor.internals.doc;
  const blockMap = (doc.blocks as Map<string, Y.Map<unknown>>).get(handle.id);
  const content = blockMap?.get('content');
  if (!content || typeof content.toDelta !== 'function') {
    return handle.textContent();
  }

  const deltas = content.toDelta();
  let result = '';

  for (const delta of deltas) {
    let text = typeof delta.insert === 'string' ? delta.insert : '';
    if (text === '\u200B') continue;

    if (delta.attributes) {
      const ordered = sortDeltaAttributes(delta.attributes, editor.schema);
      const marks = Object.entries(ordered);
      for (const [mark, props] of marks) {
        const schema = editor.schema.resolveInline(mark);
        if (!schema?.serialize?.toMarkdown) continue;
        text = schema.serialize.toMarkdown(text, typeof props === 'object' ? props : undefined);
      }
    }

    result += text;
  }

  return result;
}
```

### Dependencies

```json
{
  "dependencies": {
    "@pen/core": "workspace:*"
  }
}
```

---

## Package 6: `@pen/export-html` (New)

HTML exporter. Mirrors the markdown exporter structure.

### File Structure

```
packages/extensions/export-html/src/
├── exporter.ts      Exporter implementation
└── index.ts         Package entry
```

### Module: `exporter.ts`

```typescript
import type { Exporter, ExportOptions, Editor, BlockHandle } from '@pen/types';
import { sortDeltaAttributes } from '@pen/core';

export const htmlExporter: Exporter<string> = {
  name: 'html',
  mimeType: 'text/html',

  export(editor: Editor, options?: ExportOptions): string {
    const parts: string[] = [];
    const blockOrder = editor.documentState.blockOrder;

    for (const blockId of blockOrder) {
      const handle = editor.getBlock(blockId);
      if (!handle) continue;

      const schema = editor.schema.resolve(handle.type);
      if (!schema?.serialize?.toHTML) {
        parts.push(`<p>${escapeHTML(handle.textContent())}</p>`);
        continue;
      }

      const block = {
        id: handle.id,
        type: handle.type,
        props: handle.props,
        content: serializeInlineContentHTML(handle, editor),
      };

      parts.push(schema.serialize.toHTML(block));
    }

    return parts.join('\n');
  },
};

> **TODO (implementation):** Replace direct `Y.Text.toDelta()` access with `BlockHandle.textDeltas()`. The spec shows raw CRDT access for clarity; the implementation must use the handle API.

function serializeInlineContentHTML(handle: BlockHandle, editor: Editor): string {
  const doc = editor.internals.doc;
  const blockMap = (doc.blocks as Map<string, Y.Map<unknown>>).get(handle.id);
  const content = blockMap?.get('content');
  if (!content || typeof content.toDelta !== 'function') {
    return escapeHTML(handle.textContent());
  }

  const deltas = content.toDelta();
  let result = '';

  for (const delta of deltas) {
    let text = typeof delta.insert === 'string' ? escapeHTML(delta.insert) : '';
    if (delta.insert === '\u200B') continue;

    if (delta.attributes) {
      const ordered = sortDeltaAttributes(delta.attributes, editor.schema);
      const marks = Object.entries(ordered);
      for (const [mark, props] of marks) {
        const schema = editor.schema.resolveInline(mark);
        if (!schema?.serialize?.toHTML) continue;
        text = schema.serialize.toHTML(text, typeof props === 'object' ? props : undefined);
      }
    }

    result += text;
  }

  return result;
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

### Dependencies

```json
{
  "dependencies": {
    "@pen/core": "workspace:*"
  }
}
```

---

## Acceptance Criteria

### `@pen/transport-direct`

1. `directTransport({ toolServer })` returns a `PenTransport` with `connected === true`.
2. `stream()` yields parts from a mock tool server that returns a `Promise<unknown>` — produces a `tool-output` part followed by `done`.
3. `stream()` yields parts from a mock tool server that returns an `AsyncIterable<PenStreamPart>` — each yielded part is forwarded.
4. `disconnect()` during active stream aborts the generator — no more parts yielded.
5. Tool execution error produces an `error` part, not a thrown exception.
6. `onConnectionChange()` never fires (always connected).

### `@pen/transport-sse`

7. `sseTransport` round-trips a `PenStreamRequest` → SSE response → parsed `PenStreamPart` objects via `createSSEHandler`.
8. SSE `id:` fields use monotonic `{streamId}:{eventIndex}` format.
9. `ping` parts from the server reset the client's ping timer but are NOT yielded to the consumer.
10. Client connection state changes to `false` when `pingTimeout` elapses without events.
11. `disconnect()` aborts the active fetch and sets `connected` to `false`.
12. `onConnectionChange()` fires when connection state transitions.
13. `connect()` makes a HEAD request and sets `connected` based on response.
14. `reconnect()` sends GET with `Last-Event-ID` header.
15. If reconnect receives `501` with `X-Replay-Supported: false`, the client treats replay as unsupported and falls back to opening a fresh stream.
16. `createSSEHandler` returns a standard `Response` with `Content-Type: text/event-stream`.

### `@pen/import-markdown`

16. Import `# Hello\n\nWorld` → produces one heading block (`level: 1`, content "Hello") and one paragraph block (content "World").
17. Import `- item 1\n- item 2\n  - nested` → produces three `bulletListItem` blocks with `indent` values `0`, `0`, `1`.
18. Import `**bold** and *italic*` → produces a paragraph with `bold` mark on "bold" and `italic` mark on "italic".
19. Import `[link](https://example.com)` → produces a paragraph with `link` mark containing `href`.
20. Import `` `code` `` → produces a paragraph with `code` mark.
21. Import `~~strike~~` → produces a paragraph with `strikethrough` mark (GFM extension).
22. Import `- [ ] unchecked\n- [x] checked` → produces two `checkListItem` blocks with `checked: false` and `checked: true`.
23. Import fenced code block with language → produces `codeBlock` with `language` prop.
24. Import `---` → produces `divider` block.
25. Import `![alt](url)` → produces `image` block with `src` and `alt` props.
26. Import GFM table → produces `table` block with `hasHeaderRow` prop.
27. All blocks from a single import are in a single undo group.

### `@pen/import-html`

28. Import `<h1>Title</h1><p>Body</p>` → produces heading + paragraph blocks.
29. Import with `<script>alert('xss')</script>` → script is stripped, no block created for it.
30. Import with `<div onclick="alert('xss')">text</div>` → event handler stripped, text preserved as paragraph.
31. Import with `<a href="javascript:void(0)">link</a>` → `javascript:` URL neutralized.
32. Import `<strong>bold</strong>` → paragraph with `bold` mark.
33. Import `<em>italic</em>` → paragraph with `italic` mark.
34. Import `<a href="https://example.com">text</a>` → paragraph with `link` mark containing `href`.
35. Import `<ul><li>a</li><li>b</li></ul>` → two `bulletListItem` blocks.
36. Import `<ol><li>a</li><li>b</li></ol>` → two `numberedListItem` blocks.
37. Import nested list `<ul><li>a<ul><li>b</li></ul></li></ul>` → two `bulletListItem` blocks with `indent` 0 and 1.
38. Import `<pre><code class="language-js">code</code></pre>` → `codeBlock` with `language: 'js'`.
39. Import `<hr />` → `divider` block.
40. Import `<img src="url" alt="text" />` → `image` block with props.
41. Both importers write all blocks in a single undo group.
42. `sanitizeHTML` is exported and strips `<script>`, `<style>`, `<iframe>`, event handlers, and `javascript:` URLs when called standalone.
43. Server-side parsing (Node.js, no `DOMParser`) produces identical blocks as browser-side parsing for the same input.

---

## Known Errata (Fix During Implementation)

1. ~~**HTML importer `import()` must be `async`.**~~ Fixed inline — the `import()` method is now `async` and returns `Promise<void>`.

2. **`blocksToOps` must live in `@pen/core/importer-utils.ts` as a shared utility.** Both markdown and HTML importers use it. Do not redeclare locally.

3. **`PendingBlock` type must be defined once in `@pen/core/importer-utils.ts`.** Remove local redeclarations in `dom-to-blocks.ts`.

4. **Add `handleCut` implementation.** Cut = copy to clipboard + `editor.deleteSelection()`. Wire into the clipboard pipeline alongside `handleCopy` and `handlePaste`.

5. **Exporters must use `BlockHandle` APIs, not raw CRDT access.** The current exporter implementations cast `doc.blocks` and call `blockMap.get('content')` directly. Use `handle.textContent()` and iterate via `DocumentState.allBlocks()` to include layout children.

6. **Add `list-grouper.ts` for markdown export.** Consecutive list items at the same indent level need wrapping logic for correct markdown output.

7. **`composeAbortSignals` should use `AbortSignal.any()` where available.** Falls back to manual listener composition with proper cleanup on abort.

8. ~~**SSE `eventHistory` must be accessible to `handleReconnect`.**~~ Fixed inline — history is stored in a shared `streamHistories` Map keyed by stream ID.
