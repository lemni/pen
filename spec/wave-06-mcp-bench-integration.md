# Wave 6 — MCP, Bench & M0 Integration

**Milestone:** M0 · **Packages:** `@pen/mcp`, `@pen/bench` · **Depends on:** Waves 0-5

---

## Goal

Ship the MCP tool server, the performance benchmark harness, and verify all M0 exit criteria end-to-end. This wave is the integration and hardening gate before M0 is declared complete. No new features — this wave validates that Waves 0-5 compose correctly and meet performance targets.

---

## Package 1: `@pen/mcp`

MCP (Model Context Protocol) server (Spec Section 13.2). Exposes Pen's `ToolServer` tools to external MCP clients (Claude Desktop, Cursor, custom agents).

### File Structure

```
packages/providers/mcp/src/
├── server.ts               createMCPServer() factory
├── tool-bridge.ts          ToolDefinition → MCP tool descriptor mapping
├── transport-stdio.ts      stdio transport adapter
├── transport-sse.ts        SSE transport adapter
├── transport-http.ts       Streamable HTTP transport adapter
├── types.ts                Configuration types
└── index.ts                Package entry
```

### Import DAG

```
types.ts             ← (@pen/core)
tool-bridge.ts       ← types.ts, (@pen/core)
transport-stdio.ts   ← types.ts, (@modelcontextprotocol/sdk)
transport-sse.ts     ← types.ts, (@modelcontextprotocol/sdk)
transport-http.ts    ← types.ts, (@modelcontextprotocol/sdk)
server.ts            ← types.ts, tool-bridge.ts, transport-*.ts, (@pen/core), (@modelcontextprotocol/sdk)
index.ts             ← server.ts, types.ts
```

No cycles.

### Module: `types.ts`

```typescript
import type { ToolServer, Editor } from '@pen/types';

export interface MCPServerOptions {
  toolServer?: ToolServer;
  editor?: Editor;
  name?: string;
  version?: string;
  transport?: 'stdio' | 'sse' | 'streamable-http';
  port?: number;
  path?: string;
}

export interface MCPServerInstance {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly running: boolean;
}
```

### Module: `tool-bridge.ts`

Maps Pen's `ToolDefinition` to MCP tool descriptors and handles result translation.

```typescript
import type { ToolDefinition, ToolServer, ToolContext } from '@pen/types';

interface MCPToolDescriptor {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export function toolDefinitionToMCPDescriptor(
  def: ToolDefinition,
): MCPToolDescriptor {
  return {
    name: def.name,
    description: def.description,
    inputSchema: normalizeInputSchema(def.inputSchema),
  };
}

export function listMCPTools(
  toolServer: ToolServer,
): MCPToolDescriptor[] {
  return toolServer.listTools().map(toolDefinitionToMCPDescriptor);
}

export async function executeMCPTool(
  toolServer: ToolServer,
  name: string,
  input: unknown,
  context: ToolContext,
): Promise<MCPToolResult> {
  try {
    const result = toolServer.executeTool(name, input, context);

    if (isAsyncIterable(result)) {
      // MCP does not support streaming tool results.
      // Buffer the full iterable and return as complete result.
      const parts: unknown[] = [];
      for await (const part of result) {
        parts.push(part);
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(parts.length === 1 ? parts[0] : parts),
          },
        ],
      };
    }

    const resolved = await result;
    return {
      content: [
        {
          type: 'text',
          text: typeof resolved === 'string'
            ? resolved
            : JSON.stringify(resolved),
        },
      ],
    };
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
      isError: true,
    };
  }
}

interface MCPToolResult {
  content: Array<{ type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }>;
  isError?: boolean;
}

function normalizeInputSchema(
  schema: unknown,
): { type: 'object'; properties: Record<string, unknown>; required?: string[] } {
  if (
    typeof schema === 'object' && schema !== null &&
    (schema as { type?: string }).type === 'object'
  ) {
    return schema as Record<string, unknown>;
  }

  // Wrap non-object schemas in an object with a single 'input' property
  return {
    type: 'object',
    properties: {
      input: schema as Record<string, unknown>,
    },
  };
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

- **Streaming results are buffered.** MCP's `tools/call` response is a single JSON object, not a stream. `AsyncIterable` results from `ToolServer.executeTool()` are collected into an array and returned as a complete `text` content block. This is a protocol limitation, not an architectural choice — when MCP supports streaming tool results, this bridge can be updated.
- **Error isolation.** Tool execution errors are caught and returned as `isError: true` results, not thrown. This keeps the MCP protocol clean.
- **Schema normalization.** Pen's `PropSchema` is already JSON Schema 7, which MCP expects. The normalizer wraps non-object schemas in an object wrapper for compatibility.

### Module: `server.ts`

```typescript
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamablehttp.js';
import type { MCPServerOptions, MCPServerInstance } from './types.js';
import { listMCPTools, executeMCPTool } from './tool-bridge.js';
import type { ToolServer, ToolContext, Editor } from '@pen/types';

export function createMCPServer(options: MCPServerOptions): MCPServerInstance {
  const {
    toolServer: explicitToolServer,
    editor,
    name = 'pen-mcp',
    version = '0.1.0',
    transport: transportType = 'stdio',
  } = options;

  const toolServer: ToolServer = explicitToolServer
    ?? editor.internals.getSlot<ToolServer>('document-ops:toolServer')
    ?? throwMissingToolServer();

  let running = false;
  let server: Server | null = null;

  const instance: MCPServerInstance = {
    async start(): Promise<void> {
      if (running) return;

      server = new Server(
        { name, version },
        {
          capabilities: {
            tools: {},
          },
        },
      );

      // ── tools/list handler ─────────────────────────────
      server.setRequestHandler(
        { method: 'tools/list' } as { method: string },
        async () => {
          const tools = listMCPTools(toolServer);
          return { tools };
        },
      );

      // ── tools/call handler ─────────────────────────────
      server.setRequestHandler(
        { method: 'tools/call' } as { method: string },
        async (request: { params: { name: string; arguments?: unknown } }) => {
          const { name: toolName, arguments: toolInput } = request.params;

          const context: ToolContext = createToolContext(editor, toolServer);

          return executeMCPTool(toolServer, toolName, toolInput, context);
        },
      );

      // ── Connect transport ──────────────────────────────
      const transport = createTransport(transportType, options);
      await server.connect(transport);

      running = true;
    },

    async stop(): Promise<void> {
      if (!running || !server) return;
      await server.close();
      server = null;
      running = false;
    },

    get running(): boolean {
      return running;
    },
  };

  return instance;
}

function createTransport(
  type: string,
  options: MCPServerOptions,
): any {
  switch (type) {
    case 'stdio':
      return new StdioServerTransport();
    case 'sse':
      return new SSEServerTransport(options.path ?? '/mcp', options.response ?? null!);
    case 'streamable-http':
      return new StreamableHTTPServerTransport({ path: options.path ?? '/mcp' });
    default:
      return new StdioServerTransport();
  }
}

function createToolContext(
  editor: Editor | undefined,
  _toolServer: ToolServer,
): ToolContext {
  // Build a ToolContext for server-side tool execution.
  // If an editor is provided, the context includes it.
  // Otherwise, a minimal context is created.
  return {
    editor: editor ?? null,
    docId: editor ? 'default' : '',
    emit(_part) { /* No-op for MCP — results are returned, not streamed */ },
    insertBlock(blockType, props, position) {
      if (!editor) throw new Error('No editor available');
      const blockId = crypto.randomUUID();
      editor.applyWithOrigin('ai', {
        type: 'insert-block', blockId, blockType, props, position,
      });
      return blockId;
    },
    updateBlock(blockId, props) {
      if (!editor) throw new Error('No editor available');
      editor.applyWithOrigin('ai', { type: 'update-block', blockId, props });
    },
    deleteBlock(blockId) {
      if (!editor) throw new Error('No editor available');
      editor.applyWithOrigin('ai', { type: 'delete-block', blockId });
    },
    beginStreaming(blockId) {
      if (!editor) throw new Error('No editor available');
      const zoneId = crypto.randomUUID();
      editor.undoManager.stopCapturing();
      const streaming = editor.internals.getSlot<StreamingTarget>('delta-stream:target');
      streaming?.beginStreaming(zoneId, blockId);
      return zoneId;
    },
    appendDelta(zoneId, text) {
      const streaming = editor?.internals.getSlot<StreamingTarget>('delta-stream:target');
      streaming?.appendDelta(text);
    },
    endStreaming(zoneId, status) {
      const streaming = editor?.internals.getSlot<StreamingTarget>('delta-stream:target');
      streaming?.endStreaming(status);
      editor?.undoManager.stopCapturing();
    },
  } as ToolContext;
}

function throwMissingToolServer(): never {
  throw new Error(
    'createMCPServer requires either a toolServer or an editor with a toolServer. ' +
    'Pass { toolServer } or { editor } in options.',
  );
}
```

**Architecture:**

`@pen/mcp` is a bridge, not a reimplementation. It reads tool definitions from the same `ToolServer` that `ModelAdapter` uses. One set of tools, two exposure mechanisms:
- **`ModelAdapter`** — Pen drives the agentic loop, calling tools internally.
- **`@pen/mcp`** — External MCP client (Claude Desktop, Cursor) drives the conversation, Pen executes tool calls.

The `ToolContext` created for MCP tool execution includes a reference to the headless `Editor` instance (when available). This enables MCP tool calls to mutate the CRDT document directly — the same code path as `ModelAdapter`-driven tool execution. Tool-produced writes MUST use `origin: 'ai'`, and generation boundaries call `undoManager.stopCapturing()` so an entire generation is one undo group.

### Module: `index.ts`

```typescript
export { createMCPServer } from './server.js';
export type { MCPServerOptions, MCPServerInstance } from './types.js';
```

### Dependencies

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@modelcontextprotocol/sdk": "^2.0.0"
  }
}
```

The MCP SDK provides the protocol implementation (JSON-RPC, transport negotiation, capability exchange). Pen only implements the application layer (tool listing and execution).

---

## Package 2: `@pen/bench`

Performance benchmark harness (Spec Section 18.2). Dev dependency, not in the production bundle.

### File Structure

```
packages/tooling/bench/src/
├── bench.ts                 Benchmark runner and timing utilities
├── reporters/
│   ├── console.ts           Console table reporter
│   └── json.ts              JSON output reporter
├── suites/
│   ├── crdt.bench.ts        CRDT adapter benchmarks
│   ├── schema.bench.ts      Schema registry + normalization benchmarks
│   ├── streaming.bench.ts   AI streaming pipeline benchmarks
│   ├── editor.bench.ts      Editor apply pipeline benchmarks
│   └── extension.bench.ts   Extension dispatch benchmarks
├── fixtures/
│   ├── large-doc.ts         500-block test document generator
│   └── streaming-parts.ts   Mock stream part generators
└── index.ts                 Package entry
```

### Module: `bench.ts`

```typescript
export interface BenchContext {
  start(): void;
  end(): void;
}

export interface BenchResult {
  name: string;
  iterations: number;
  totalMs: number;
  averageMs: number;
  minMs: number;
  maxMs: number;
  opsPerSecond: number;
}

export interface BenchOptions {
  iterations?: number;
  warmup?: number;
  reporter?: 'console' | 'json';
}

export async function bench(
  name: string,
  fn: (b: BenchContext) => void | Promise<void>,
  options?: BenchOptions,
): Promise<BenchResult> {
  const iterations = options?.iterations ?? 100;
  const warmup = options?.warmup ?? 5;
  const times: number[] = [];

  // Warmup
  for (let i = 0; i < warmup; i++) {
    const ctx = createBenchContext();
    await fn(ctx);
  }

  // Measured runs
  for (let i = 0; i < iterations; i++) {
    const ctx = createBenchContext();
    await fn(ctx);
    if (ctx._elapsed !== null) {
      times.push(ctx._elapsed);
    }
  }

  const totalMs = times.reduce((a, b) => a + b, 0);
  const averageMs = totalMs / times.length;
  const minMs = Math.min(...times);
  const maxMs = Math.max(...times);
  const opsPerSecond = 1000 / averageMs;

  const result: BenchResult = {
    name,
    iterations: times.length,
    totalMs,
    averageMs,
    minMs,
    maxMs,
    opsPerSecond,
  };

  return result;
}

function createBenchContext(): BenchContext & { _elapsed: number | null } {
  let startTime = 0;
  const ctx = {
    _elapsed: null as number | null,
    start() {
      startTime = performance.now();
    },
    end() {
      ctx._elapsed = performance.now() - startTime;
    },
  };
  return ctx;
}

export async function runSuite(
  name: string,
  benchmarks: Array<{ name: string; fn: (b: BenchContext) => void | Promise<void> }>,
  options?: BenchOptions,
): Promise<BenchResult[]> {
  const results: BenchResult[] = [];

  console.log(`\n  Suite: ${name}\n`);

  for (const benchmark of benchmarks) {
    const result = await bench(benchmark.name, benchmark.fn, options);
    results.push(result);

    const status = result.averageMs < getTarget(benchmark.name) ? '✓' : '✗';
    console.log(
      `  ${status} ${result.name}: ${result.averageMs.toFixed(2)}ms avg ` +
      `(min: ${result.minMs.toFixed(2)}ms, max: ${result.maxMs.toFixed(2)}ms, ` +
      `${result.opsPerSecond.toFixed(0)} ops/s)`,
    );
  }

  return results;
}

const TARGETS: Record<string, number> = {
  'insert 1000 blocks': 500,
  'normalize 500-block document': 200,
  'streaming 1000 gen-delta parts': 10,
  'encodeState 500-block document': 50,
  'loadDocument 500-block document': 100,
  'schema resolve x10000': 10,
  'extension dispatch x5': 1,
};

function getTarget(name: string): number {
  for (const [key, target] of Object.entries(TARGETS)) {
    if (name.toLowerCase().includes(key.toLowerCase())) return target;
  }
  return Infinity;
}
```

### Benchmark Suites

#### `suites/crdt.bench.ts`

```typescript
import { bench } from '../bench.js';
import { yjsAdapter } from '@pen/crdt-yjs';
import { initBlockMap } from '@pen/crdt-yjs';
import * as Y from 'yjs';

export const crdtBenchmarks = [
  {
    name: 'insert 1000 blocks sequentially',
    async fn(b) {
      const adapter = yjsAdapter();
      const doc = adapter.createDocument();

      b.start();
      adapter.transact(doc, () => {
        const blocks = doc.penDocument.blocks;
        const blockOrder = doc.penDocument.blockOrder;
        for (let i = 0; i < 1000; i++) {
          const id = `block-${i}`;
          initBlockMap(blocks, id, 'paragraph', 'inline');
          blockOrder.push([id]);
        }
      });
      b.end();
    },
  },
  {
    name: 'encodeState 500-block document',
    async fn(b) {
      const { doc, adapter } = createLargeDocument(500);
      b.start();
      adapter.encodeState(doc);
      b.end();
    },
  },
  {
    name: 'loadDocument 500-block document',
    async fn(b) {
      const { doc, adapter } = createLargeDocument(500);
      const binary = adapter.encodeState(doc);
      b.start();
      adapter.loadDocument(binary);
      b.end();
    },
  },
  {
    name: 'fork + merge 100-block document',
    async fn(b) {
      const { doc, adapter } = createLargeDocument(100);
      b.start();
      const forked = adapter.fork(doc);
      adapter.merge(doc, forked);
      b.end();
    },
  },
];
```

#### `suites/schema.bench.ts`

```typescript
import { bench } from '../bench.js';
import { defaultSchema } from '@pen/schema-default';
import { SchemaEngineImpl } from '@pen/core';

export const schemaBenchmarks = [
  {
    name: 'schema resolve x10000',
    fn(b) {
      const types = [
        'paragraph', 'heading', 'bulletListItem', 'codeBlock',
        'table', 'image', 'divider', 'callout',
      ];

      b.start();
      for (let i = 0; i < 10000; i++) {
        defaultSchema.resolve(types[i % types.length]);
      }
      b.end();
    },
  },
  {
    name: 'normalize 500-block document',
    async fn(b) {
      const { doc, crdtDoc } = createLargeDocument(500);
      const engine = new SchemaEngineImpl(defaultSchema, doc, crdtDoc);

      b.start();
      engine.normalizeAll();
      b.end();
    },
  },
  {
    name: 'allBlockDisplays (slash menu population)',
    fn(b) {
      b.start();
      for (let i = 0; i < 10000; i++) {
        defaultSchema.allBlockDisplays();
      }
      b.end();
    },
  },
];
```

#### `suites/streaming.bench.ts`

```typescript
import { bench } from '../bench.js';

export const streamingBenchmarks = [
  {
    name: 'streaming 1000 gen-delta parts at 100/sec',
    async fn(b) {
      const editor = createTestEditor();
      const blockId = insertParagraph(editor);
      const streaming = getStreamingTarget(editor);

      b.start();

      const zoneId = 'test-zone';
      streaming.beginStreaming(zoneId, blockId);

      for (let i = 0; i < 1000; i++) {
        streaming.appendDelta(`token-${i} `);

        // Simulate 100 tokens/sec (10ms between tokens)
        // But we don't actually wait — we measure the processing time
        if (i % 10 === 0) {
          // Batch flush every 10 tokens
          await flushMicrotasks();
        }
      }

      streaming.endStreaming('complete');
      b.end();
    },
  },
  {
    name: 'streaming batch flush latency',
    async fn(b) {
      const editor = createTestEditor();
      const blockId = insertParagraph(editor);
      const streaming = getStreamingTarget(editor);

      streaming.beginStreaming('zone', blockId);

      // Measure single batch flush (50 tokens)
      for (let i = 0; i < 49; i++) {
        streaming.appendDelta(`t${i} `);
      }

      b.start();
      streaming.appendDelta('final ');
      await flushMicrotasks();
      b.end();
    },
  },
];

function flushMicrotasks(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}
```

#### `suites/editor.bench.ts`

```typescript
export const editorBenchmarks = [
  {
    name: 'editor.apply insert-text x1000',
    fn(b) {
      const editor = createTestEditor({ blocks: [{ type: 'paragraph' }] });
      const blockId = getFirstBlockId(editor);

      b.start();
      for (let i = 0; i < 1000; i++) {
        editor.apply([{
          type: 'insert-text',
          blockId,
          offset: i,
          text: 'x',
        }]);
      }
      b.end();
    },
  },
  {
    name: 'editor.apply insert-block + delete-block x500',
    fn(b) {
      const editor = createTestEditor();

      b.start();
      for (let i = 0; i < 500; i++) {
        const id = `bench-${i}`;
        editor.apply([{
          type: 'insert-block',
          blockId: id,
          blockType: 'paragraph',
          props: {},
          position: 'last',
        }]);
        editor.apply([{ type: 'delete-block', blockId: id }]);
      }
      b.end();
    },
  },
];
```

#### `suites/extension.bench.ts`

```typescript
export const extensionBenchmarks = [
  {
    name: 'extension dispatchObserve with 5 extensions',
    fn(b) {
      const editor = createTestEditorWithExtensions(5);

      // Trigger a change
      const blockId = getFirstBlockId(editor);

      b.start();
      editor.apply([{
        type: 'insert-text',
        blockId,
        offset: 0,
        text: 'benchmark text',
      }]);
      b.end();
    },
  },
  {
    name: 'extension collectDecorations with 5 extensions',
    fn(b) {
      const editor = createTestEditorWithExtensions(5);

      b.start();
      for (let i = 0; i < 1000; i++) {
        editor.getDecorations();
      }
      b.end();
    },
  },
];
```

### Module: `fixtures/large-doc.ts`

```typescript
import { yjsAdapter, initBlockMap } from '@pen/crdt-yjs';
import * as Y from 'yjs';

export function createLargeDocument(blockCount: number) {
  const adapter = yjsAdapter();
  const doc = adapter.createDocument();

  adapter.transact(doc, () => {
    const blocks = doc.penDocument.blocks;
    const blockOrder = doc.penDocument.blockOrder;

    for (let i = 0; i < blockCount; i++) {
      const id = `block-${i}`;
      const type = i === 0 ? 'heading' :
                   i % 10 === 0 ? 'heading' :
                   i % 5 === 0 ? 'codeBlock' :
                   'paragraph';

      initBlockMap(blocks, id, type, type === 'codeBlock' ? 'inline' : 'inline');
      blockOrder.push([id]);

      const blockMap = blocks.get(id);
      const content = blockMap?.get('content');
      if (content instanceof Y.Text) {
        content.insert(0, `Content for block ${i}. This is some sample text that simulates real document content with varying lengths.`);
      }

      if (type === 'heading') {
        const props = blockMap?.get('props');
        if (props instanceof Y.Map) {
          props.set('level', (i % 3) + 1);
        }
      }
    }
  });

  return { doc, adapter, ydoc: adapter.raw(doc) };
}
```

### Module: `index.ts`

```typescript
export { bench, runSuite } from './bench.js';
export type { BenchContext, BenchResult, BenchOptions } from './bench.js';

export { crdtBenchmarks } from './suites/crdt.bench.js';
export { schemaBenchmarks } from './suites/schema.bench.js';
export { streamingBenchmarks } from './suites/streaming.bench.js';
export { editorBenchmarks } from './suites/editor.bench.js';
export { extensionBenchmarks } from './suites/extension.bench.js';
export { createLargeDocument } from './fixtures/large-doc.js';
```

### M0 Benchmark Targets

These targets use a fixed benchmark harness (release build, warmup enabled, reference fixture, p50/p95 over multiple runs). Critical-path targets are release gates; the rest are regression baselines.

| Benchmark | Target | Rationale |
|---|---|---|
| Insert 1000 blocks sequentially | < 500ms | 1000+ block document creation must be fast enough for large imports and AI batch operations. |
| Normalize 500-block document (`normalizeAll`) | < 200ms | Document load normalization should not block initial render. |
| AI streaming: 1000 `gen-delta` parts at 100/sec | No dropped tokens, < 10ms per batch flush | Token-level streaming must be smooth. The 10ms target ensures 100fps DOM update budget. |
| `encodeState()` on 500-block document | < 50ms | Persistence snapshot must be fast enough for auto-save. |
| `loadDocument()` from binary on 500-block doc | < 100ms | Document load from binary should feel instant. |
| Schema registry `resolve()` × 10,000 lookups | < 10ms | Schema resolution is called per-block on every render and normalization pass. |
| Extension `dispatchObserve()` with 5 extensions | < 1ms per dispatch | Extension observation should not be a bottleneck on the CRDT event path. |

### Dependencies

```json
{
  "devDependencies": {
    "@pen/core": "workspace:*",
    "@pen/crdt-yjs": "workspace:*",
    "@pen/schema-default": "workspace:*",
    "@pen/test": "workspace:*"
  }
}
```

Dev dependency only. Not in the production bundle.

---

## M0 Exit Criteria Verification

This is the integration testing checklist. Every item must pass before M0 is declared complete.

### Criterion 1: Zero-config editor renders

```tsx
const editor = createEditor()
<PenEditor editor={editor} />
```

**Verification steps:**
1. The above code renders an empty editor in a React application.
2. All default schema blocks are available (12 block types, 9 inline marks, 2 inline nodes).
3. The user can type in the default paragraph block.
4. The user can format text (bold, italic, etc.) via keyboard shortcuts.
5. The user can navigate between blocks with arrow keys.
6. The slash menu opens on `/` in an empty paragraph and lists all default block types.
7. Selecting a slash menu item converts the block or inserts a new block.

**What to test:**
- `createEditor()` with zero arguments includes `@pen/document-ops`, `@pen/delta-stream`, and `@pen/undo` extensions by default.
- `defaultSchema` is used when no `schema` option is provided.
- `yjsAdapter()` is used when no `crdt` option is provided.
- The editor starts with a single empty paragraph block.

### Criterion 2: AI streaming via ModelAdapter

**Verification steps:**
1. Create a `ModelAdapter` wrapping any LLM client (e.g., AI SDK with Anthropic).
2. Pass the adapter to `createEditor({ model: adapter })` or configure `@pen/ai`.
3. Trigger an AI generation (via command menu, toolbar button, or programmatic call).
4. Tokens appear in real-time as `gen-delta` parts stream in.
5. The generation zone is visible (`data-ai-generating` attribute on the target block).
6. The generation completes (`gen-end` part received).
7. The `StreamingTarget` correctly batches tokens (50-100ms window) before flushing to CRDT.

**What to test:**
- Token insertion rate: 100+ tokens/sec renders smoothly without dropped tokens.
- `gen-start` → `gen-delta` × N → `gen-end` lifecycle completes correctly.
- The generation zone defers normalization during streaming and normalizes on `gen-end`.
- The block's Y.Text content matches the accumulated deltas after generation.

### Criterion 3: AI streaming via MCP

**Verification steps:**
1. Start an MCP server via `createMCPServer({ editor })` with `transport: 'stdio'`.
2. Configure an MCP client (e.g., Claude Desktop) to connect to the Pen MCP server.
3. The MCP client calls `tools/list` — all `@pen/document-ops` tools are listed.
4. The MCP client calls `read_document` — returns document content.
5. The MCP client calls `write_document` — mutates the CRDT document.
6. The change is visible in the editor (React renders the update).
7. The MCP client calls `insert_block` — a new block appears in the editor.
8. The MCP client calls `delete_block` — the block is removed.

**What to test:**
- Tool listing includes all default tools: `read_document`, `write_document`, `get_context`, `search_document`, `list_block_types`, `insert_block`, `update_block`, `delete_block`, `move_block`.
- Tool input schemas match the JSON Schema 7 format expected by MCP.
- Tool execution produces correct CRDT mutations.
- The headless editor's Y.Doc is the same CRDT peer as the React editor — mutations propagate.

### Criterion 4: Undo/redo groups AI generations

**Verification steps:**
1. Create an editor with content: two paragraphs.
2. User types "hello" in the first paragraph → creates a user undo group.
3. Trigger an AI generation that inserts text into the second paragraph.
4. AI generation completes.
5. Press Ctrl+Z → the entire AI generation is undone in one step.
6. Press Ctrl+Y → the entire AI generation is redone.
7. Press Ctrl+Z again → AI generation undone.
8. Press Ctrl+Z again → user's "hello" text is undone.

**What to test:**
- AI generation (`origin: 'ai'`) creates a separate undo group.
- `UndoManager.stopCapturing()` fires at generation boundaries.
- User edits OUTSIDE the generation zone during streaming are separate undo groups.
- User edits INSIDE the generation zone during streaming join the generation's undo group.

### Criterion 5: Cross-block selection

**Verification steps:**
1. Create a document with 10 blocks.
2. Click in block 3, then shift-click in block 7.
3. Blocks 3-7 are highlighted (`data-selected` attribute on each).
4. Type "replacement" → all selected blocks are deleted and replaced with a single paragraph containing "replacement".
5. Copy the selection → clipboard contains `text/html`, `text/plain`, and `application/x-pen-blocks`.
6. Paste the copied content → blocks 3-7 are recreated with original types and formatting.

**What to test:**
- `expandTo()` correctly computes the range of blocks.
- Typing with cross-block selection replaces the selection.
- Copy/paste preserves block types, props, and inline formatting.
- Cross-block selection with >50 blocks uses `BlockSelection` instead of contenteditable expansion.

### Criterion 6: Headless test suite

**Verification steps:**
1. `pnpm test` passes across all packages.
2. Test coverage includes:

| Category | Tests |
|---|---|
| Schema normalization | All 11 rules, idempotency verification for each |
| `editor.apply()` | Every `DocumentOp` type (24 op types) |
| Undo/redo | Boundary creation, origin filtering, group merging |
| Extension lifecycle | `activate`, `observe`, `deactivate`, dependency resolution |
| Streaming pipeline | `gen-start`/`gen-delta`/`gen-end`, batching, deferral |
| Import Markdown | All supported syntax (headings, lists, code, tables, inline marks) |
| Import HTML | All supported elements, sanitization of XSS vectors |
| Collaboration convergence | Two editors sync via CRDT exchange, `assertDocEquals` passes |
| Schema registry | `resolve`, `extend`, `without`, `override`, `mergeSchemas` |
| BlockHandle | All properties, traversal methods, metadata read/write |

**What to test:**
- All tests run without a browser (headless, Node.js).
- Tests use `@pen/test` utilities: `createTestEditor`, `createTestDocument`, `assertDocEquals`, `createTestCollaboration`.
- Collaboration tests verify that concurrent edits from two editors converge after CRDT exchange.

### Criterion 7: Development-mode diagnostics

**Verification steps:**

1. **Missing primitive context:**
   ```tsx
   <Pen.Toolbar.Button>Bold</Pen.Toolbar.Button>
   // Without Pen.Editor.Root → console.error with actionable message
   ```
   The error names the missing ancestor and suggests the fix.

2. **Schema validation fallback:**
   - An LLM generates a `block-insert` part with `blockType: 'unknown_type'`.
   - The `onUnknownBlock` handler fires.
   - A diagnostic event is emitted: `{ type: 'validation-error', op, reason }`.
   - The consumer can subscribe via `editor.on('diagnostic', callback)`.

3. **Extension conflict:**
   - Register an extension with `dependencies: ['missing-ext']`.
   - `ExtensionManager` throws with a message naming both the missing dependency and the dependent extension.
   - Circular dependencies produce a clear error message naming the cycle.

**What to test:**
- Development-mode diagnostics produce `console.error` (not `console.warn` or silent failure).
- Production builds strip diagnostic code (tree-shaking via `process.env.NODE_ENV` checks).
- Each diagnostic includes the component/extension name and a suggested fix.

---

## Integration Test Scenarios

Beyond the exit criteria, these end-to-end scenarios validate the full M0 stack:

### Scenario A: Full editing session

1. Create editor → type heading "My Document" → press Enter.
2. Type paragraph content with bold and italic formatting.
3. Press `/` → select "Bullet List" from slash menu.
4. Type three list items with varying indent levels.
5. Copy all content → paste into a new block.
6. Undo 3 times → redo 2 times.
7. Verify document state matches expected.

### Scenario B: AI generation with concurrent editing

1. Create editor with 5 blocks.
2. Start AI generation in block 3.
3. While AI is streaming, user types in block 1.
4. AI generation completes.
5. Undo → AI generation reverted, user's edit in block 1 preserved.
6. Redo → AI generation restored.

### Scenario C: MCP round-trip

1. Start MCP server with headless editor.
2. MCP client calls `get_context(format: 'summary')`.
3. MCP client calls `insert_block` to add a heading.
4. MCP client calls `write_document` to add paragraph content.
5. MCP client calls `read_document` → verifies content includes the new blocks.
6. Headless editor's Y.Doc state is encoded and loaded in a React editor.
7. React editor renders the MCP-created content correctly.

### Scenario D: Paste from external source

1. Copy rich text from Google Docs (heading + styled paragraph + list).
2. Paste into Pen editor.
3. Verify: heading block with correct level, paragraph with bold/italic marks, list items with correct types and indent levels.
4. Verify: no `<script>`, `<style>`, or event handler content in the CRDT.
5. Verify: single undo step for the entire paste.

### Scenario E: Collaboration convergence

1. Create two test editors sharing the same initial document.
2. Editor A inserts text at position 5 in block 1.
3. Editor B inserts text at position 5 in the same block 1.
4. Sync CRDT updates between editors.
5. `assertDocEquals(editorA, editorB)` passes — both editors have identical content.
6. Both editors' text contains contributions from both A and B (no lost content).

---

## Key Decisions

1. **MCP is a bridge, not a reimplementation.** It reads from the same `ToolServer` that `ModelAdapter` uses. One set of tools, two exposure mechanisms.

2. **Streaming results are buffered for MCP.** MCP's current protocol does not support streaming tool results. `AsyncIterable` results are collected into an array. When MCP adds streaming support, the bridge can be updated without changing tool implementations.

3. **Benchmarks are mixed gates.** Most benchmarks remain baseline-tracking, but critical hot paths are blocking in M0: `streaming batch flush latency`, `normalizeAll` on the reference fixture, and extension `dispatchObserve`. Failing these requires either a fix or an explicit waiver with rationale and owner before release.

4. **M0 exit criteria are pass/fail.** If any criterion fails, the wave is not complete. Each criterion has explicit verification steps and test coverage requirements.

5. **`@pen/bench` is a dev dependency.** Not included in the production bundle. Uses `performance.now()` for timing (high-resolution, monotonic). Supports warmup runs to eliminate JIT compilation noise.

6. **`ToolContext` for MCP includes the editor.** This enables MCP tool calls to mutate the document directly, using the same code path as `ModelAdapter`-driven tool execution. The `emit()` method is a no-op for MCP (results are returned, not streamed).

7. **Integration tests exercise the full stack.** Scenarios A-E cover editing, AI generation, MCP, paste, and collaboration. These are not unit tests — they verify that Waves 0-5 compose correctly.

---

## Acceptance Criteria

### `@pen/mcp`

1. `createMCPServer({ editor })` creates an MCP server instance.
2. MCP server starts and lists all `@pen/document-ops` tools via `tools/list`.
3. Tool descriptors have correct `name`, `description`, and `inputSchema` (JSON Schema 7 format).
4. An MCP `tools/call` request for `read_document` returns document content as a text content block.
5. An MCP `tools/call` request for `write_document` mutates the CRDT and the change is visible in the editor.
6. An MCP `tools/call` request for `insert_block` creates a new block visible in the editor.
7. An MCP `tools/call` request for `delete_block` removes the block from the editor.
8. An MCP `tools/call` request for `search_document` returns matching blocks with snippets.
9. MCP server works over stdio transport.
10. MCP server works over SSE transport (when configured).
11. Tool execution errors return `isError: true` results, not protocol errors.
12. `AsyncIterable` tool results are buffered and returned as complete results.
13. `stop()` cleanly shuts down the MCP server.
14. `createMCPServer` without `toolServer` or `editor` throws a descriptive error.

### `@pen/bench`

15. All M0 benchmarks run and produce timing results.
16. `bench()` returns `BenchResult` with `averageMs`, `minMs`, `maxMs`, `opsPerSecond`.
17. Warmup runs are excluded from measured results.
18. `createLargeDocument(500)` produces a valid 500-block document with mixed block types.
19. CRDT benchmarks: insert, encode, load, fork/merge all produce results.
20. Schema benchmarks: resolve, normalize all produce results.
21. Streaming benchmarks: gen-delta processing produces results.
22. Editor benchmarks: apply pipeline produces results.
23. Extension benchmarks: dispatch, collectDecorations produce results.

### M0 Exit Criteria

24. Exit criterion 1: Zero-config editor renders and is interactive.
25. Exit criterion 2: AI streaming via `ModelAdapter` works end-to-end.
26. Exit criterion 3: MCP tools are callable by external clients.
27. Exit criterion 4: Undo/redo correctly groups AI generations.
28. Exit criterion 5: Cross-block selection works for 3+ blocks.
29. Exit criterion 6: `pnpm test` passes across all packages.
30. Exit criterion 7: Development-mode diagnostics fire for common mistakes.
