# Wave 7 — AI Extension & Track Changes

**Milestone:** M1 · **Packages:** `@pen/ai` · **Depends on:** M0 (Waves 0-6)

---

## Goal

Ship the AI behavioral layer: command menu, generation zone UI, ephemeral suggestions (ghost text), persistent track changes (suggestion marks), accept/reject lifecycle, diff view, and the agentic tool-calling loop. After this wave, an LLM can read documents, stream edits, and produce reviewable suggestions — and users can accept, reject, or retry each generation.

---

## File Structure

```
packages/extensions/ai/src/
├── extension.ts              defineExtension — entry point, CRDT observer, decoration producer
├── agentic/
│   ├── loop.ts               Agentic tool-calling loop (model → tool → model → …)
│   ├── context-builder.ts    Builds ToolContext with streaming helpers
│   └── awareness.ts          AIAwarenessState publisher
├── suggestions/
│   ├── ephemeral.ts          Ephemeral suggestion state (local-only, ghost text)
│   ├── persistent.ts         Persistent suggestion CRDT operations (suggestion mark read/write)
│   ├── accept-reject.ts      Accept/reject logic for both inline and block-level suggestions
│   ├── suggest-mode.ts       Suggest-mode interceptor for editor.apply()
│   └── block-suggestion.ts   Block-level suggestion metadata (insert/delete/move/convert)
├── decorations/
│   ├── track-changes.ts      CRDT-derived decorations from suggestion marks
│   ├── generation-zone.ts    Generation zone highlight decorations
│   └── ephemeral-render.ts   Ghost text decorations for ephemeral suggestions
├── commands/
│   ├── registry.ts           AICommandBinding registry with context predicates
│   ├── guards.ts             Contextual guard predicates (hasSelection, blockType, etc.)
│   └── default-commands.ts   Built-in AI commands (rewrite, continue, summarize, etc.)
├── primitives/
│   ├── root.tsx              Pen.AI.Root — context provider
│   ├── trigger.tsx           Pen.AI.Trigger — opens command menu
│   ├── command-menu.tsx      Pen.AI.CommandMenu / CommandInput / CommandList / CommandItem
│   ├── generation-zone.tsx   Pen.AI.GenerationZone
│   ├── streaming-text.tsx    Pen.AI.StreamingText
│   ├── action-bar.tsx        Pen.AI.ActionBar / Accept / Reject / Retry
│   ├── suggestion.tsx        Pen.AI.Suggestion — ephemeral ghost text
│   ├── track-changes.tsx     Pen.AI.TrackChanges / TrackChanges.Mark
│   ├── diff-view.tsx         Pen.AI.DiffView
│   ├── progress.tsx          Pen.AI.Progress / StepIndicator / ToolInvocation
│   └── index.ts              Barrel
├── hooks/
│   ├── use-ai.ts             useAI() — AI context (model, status, active generation)
│   ├── use-generation.ts     useGeneration() — current generation state
│   ├── use-suggestions.ts    useSuggestions() — list of active persistent suggestions
│   ├── use-suggest-mode.ts   useSuggestMode() — toggle suggest mode
│   └── index.ts              Barrel
├── types.ts                  AI-specific types
└── index.ts                  Package entry
```

### Import DAG

```
types.ts                ← (@pen/core)
agentic/loop.ts         ← types.ts, agentic/context-builder.ts, agentic/awareness.ts, (@pen/core)
agentic/context-builder.ts ← types.ts, (@pen/core)
agentic/awareness.ts    ← types.ts, (@pen/core)
suggestions/ephemeral.ts    ← types.ts, (@pen/core)
suggestions/persistent.ts   ← types.ts, (@pen/core)
suggestions/accept-reject.ts ← suggestions/persistent.ts, suggestions/block-suggestion.ts, (@pen/core)
suggestions/suggest-mode.ts  ← suggestions/persistent.ts, suggestions/block-suggestion.ts, (@pen/core)
suggestions/block-suggestion.ts ← types.ts, (@pen/core)
decorations/track-changes.ts   ← suggestions/persistent.ts, (@pen/core)
decorations/generation-zone.ts ← types.ts, (@pen/core)
decorations/ephemeral-render.ts ← suggestions/ephemeral.ts, (@pen/core)
commands/registry.ts    ← types.ts, commands/guards.ts
commands/guards.ts      ← (@pen/core)
commands/default-commands.ts ← commands/registry.ts, agentic/loop.ts
extension.ts            ← decorations/*, suggestions/*, agentic/*, commands/*, (@pen/core)
primitives/*            ← hooks/*, extension.ts, (@pen/core), (react)
hooks/*                 ← extension.ts, types.ts, (@pen/core), (react)
```

No cycles.

---

## Module: `types.ts` — AI Types

```typescript
import type {
  Editor, ModelAdapter, Unsubscribe, BlockHandle,
  PenStreamPart, Position, SelectionState, DecorationSet,
  ModelMessage, ApplyOptions,
} from '@pen/types';

export interface AIExtensionConfig {
  model?: ModelAdapter;
  suggestMode?: boolean;
  commands?: AICommandBinding[];
  maxAgenticSteps?: number;
}

export interface AIExtensionState {
  status: AIStatus;
  activeGeneration: GenerationState | null;
  suggestMode: boolean;
  ephemeralSuggestion: EphemeralSuggestion | null;
  commandMenuOpen: boolean;
}

export type AIStatus =
  | 'idle'
  | 'reading'
  | 'thinking'
  | 'writing'
  | 'tool-calling';

export interface GenerationState {
  id: string;
  zoneId: string;
  blockId: string;
  prompt: string;
  status: 'streaming' | 'complete' | 'cancelled' | 'error';
  tokenCount: number;
  steps: AgenticStep[];
  undoGroupId: string;
}

export interface AgenticStep {
  index: number;
  type: 'text' | 'tool-call' | 'tool-result';
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
  output?: unknown;
  status: 'pending' | 'running' | 'complete' | 'error';
}

export interface EphemeralSuggestion {
  id: string;
  blockId: string;
  offset: number;
  text: string;
  type: 'inline' | 'block';
  blockType?: string;
  props?: Record<string, unknown>;
}

export interface AICommandBinding {
  id: string;
  label: string;
  description?: string;
  icon?: string;
  group?: string;
  prompt: string | ((ctx: AICommandContext) => string);
  guard?: AICommandGuard;
  shortcut?: string;
}

export interface AICommandContext {
  editor: Editor;
  selection: SelectionState;
  selectedText: string;
  blockType: string | null;
  blockId: string | null;
}

export type AICommandGuard = (ctx: AICommandContext) => boolean;

export interface AIAwarenessState {
  status: AIStatus;
  activeBlockId: string | null;
  activeTool?: { name: string; toolCallId: string };
  model: string;
  generationZoneId?: string;
}

export interface PersistentSuggestion {
  id: string;
  action: 'insert' | 'delete';
  author: string;
  authorType: 'user' | 'ai';
  createdAt: number;
  model?: string;
  blockId: string;
  offset: number;
  length: number;
}

export interface BlockSuggestionMeta {
  id: string;
  action: 'insert-block' | 'delete-block' | 'move-block' | 'convert-block';
  author: string;
  authorType: 'user' | 'ai';
  createdAt: number;
  model?: string;
  previousState?: {
    type?: string;
    position?: Position;
    props?: Record<string, unknown>;
  };
}
```

---

## Module: `agentic/loop.ts` — Agentic Tool-Calling Loop

The core model-tool-model loop. Accepts a `ModelAdapter`, calls the model, parses tool calls, executes via `ToolServer`, feeds results back, repeats until the model produces text without tool calls or hits the step limit.

```typescript
import type { ModelAdapter, ToolServer, Editor, Unsubscribe, ModelMessage, StreamingTarget, PenStreamPart } from '@pen/types';
import type { GenerationState, AgenticStep, AIAwarenessState } from '../types.js';
import { buildToolContext } from './context-builder.js';
import { publishAwareness } from './awareness.js';

export interface AgenticLoopOptions {
  model: ModelAdapter;
  editor: Editor;
  toolServer: ToolServer;
  prompt: string;
  blockId: string;
  maxSteps?: number;
  signal?: AbortSignal;
  onStatusChange?: (status: AIAwarenessState['status']) => void;
  onStep?: (step: AgenticStep) => void;
  onEmit?: (part: PenStreamPart) => void;
}

export async function runAgenticLoop(
  options: AgenticLoopOptions,
): Promise<GenerationState> {
  const {
    model, editor, toolServer, prompt, blockId,
    maxSteps = 10, signal, onStatusChange, onStep, onEmit,
  } = options;

  const generationId = crypto.randomUUID();
  const zoneId = crypto.randomUUID();
  const steps: AgenticStep[] = [];
  let stepIndex = 0;
  let consecutiveErrors = new Map<string, number>();

  const tools = toolServer.listTools().map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));

  const messages: ModelMessage[] = [
    { role: 'user', content: prompt },
  ];

  const streamingTarget = editor.internals.getSlot<StreamingTarget>('delta-stream:target');
  const ctx = buildToolContext(editor, zoneId, blockId, streamingTarget, onEmit);

  editor.undoManager.stopCapturing();

  onStatusChange?.('thinking');
  publishAwareness(editor, { status: 'thinking', activeBlockId: blockId, model: getModelName(model) });

  while (stepIndex < maxSteps) {
    if (signal?.aborted) break;

    const availableTools = tools.filter(t => {
      const errors = consecutiveErrors.get(t.name) ?? 0;
      return errors < 3;
    });

    const stream = model.stream({ messages, tools: availableTools, signal });

    let textBuffer = '';
    let pendingToolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }> = [];

    for await (const event of stream) {
      if (signal?.aborted) break;

      if (event.type === 'text-delta') {
        if (textBuffer === '' && pendingToolCalls.length === 0) {
          onStatusChange?.('writing');
          publishAwareness(editor, {
            status: 'writing',
            activeBlockId: blockId,
            model: getModelName(model),
            generationZoneId: zoneId,
          });
          streamingTarget?.beginStreaming(zoneId, blockId);
        }
        textBuffer += event.delta;
        streamingTarget?.appendDelta(event.delta);
      }

      if (event.type === 'tool-call') {
        pendingToolCalls.push({
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: event.input,
        });
      }

      if (event.type === 'done') break;

      if (event.type === 'error') {
        streamingTarget?.endStreaming('error');
        throw event.error;
      }
    }

    if (textBuffer.length > 0) {
      streamingTarget?.endStreaming('complete');
    }

    if (pendingToolCalls.length === 0) break;

    const assistantParts = pendingToolCalls.map(tc => ({
      type: 'tool-call' as const,
      toolCallId: tc.toolCallId,
      toolName: tc.toolName,
      input: tc.input,
    }));
    messages.push({ role: 'assistant', content: assistantParts });

    for (const toolCall of pendingToolCalls) {
      const step: AgenticStep = {
        index: stepIndex++,
        type: 'tool-call',
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        input: toolCall.input,
        status: 'running',
      };
      steps.push(step);
      onStep?.(step);

      onStatusChange?.('tool-calling');
      publishAwareness(editor, {
        status: 'tool-calling',
        activeBlockId: blockId,
        model: getModelName(model),
        activeTool: { name: toolCall.toolName, toolCallId: toolCall.toolCallId },
      });

      try {
        const result = toolServer.executeTool(toolCall.toolName, toolCall.input, ctx);
        let output: unknown;

        if (result && typeof result === 'object' && Symbol.asyncIterator in result) {
          const parts: unknown[] = [];
          for await (const part of result as AsyncIterable<unknown>) {
            parts.push(part);
          }
          output = parts.length === 1 ? parts[0] : parts;
        } else {
          output = await result;
        }

        step.output = output;
        step.status = 'complete';
        consecutiveErrors.set(toolCall.toolName, 0);

        const resultStep: AgenticStep = {
          index: stepIndex++,
          type: 'tool-result',
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output,
          status: 'complete',
        };
        steps.push(resultStep);
        onStep?.(resultStep);

        messages.push({
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: toolCall.toolCallId, result: output }],
        });
      } catch (error) {
        step.status = 'error';
        const errorCount = (consecutiveErrors.get(toolCall.toolName) ?? 0) + 1;
        consecutiveErrors.set(toolCall.toolName, errorCount);

        messages.push({
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: toolCall.toolCallId, result: error instanceof Error ? error.message : String(error), isError: true }],
        });
      }
    }
  }

  editor.undoManager.stopCapturing();

  onStatusChange?.('idle');
  publishAwareness(editor, { status: 'idle', activeBlockId: null, model: getModelName(model) });

  return {
    id: generationId,
    zoneId,
    blockId,
    prompt,
    status: signal?.aborted ? 'cancelled' : 'complete',
    tokenCount: 0,
    steps,
    undoGroupId: generationId,
  };
}

function getModelName(model: ModelAdapter & { name?: string; modelId?: string }): string {
  return model.name ?? model.modelId ?? 'unknown';
}
```

**Key design decisions:**

- **`StreamingTarget` from slot system.** The context builder resolves `StreamingTarget` via `editor.internals.getSlot('delta-stream:target')`, connecting to the `@pen/delta-stream` extension's batching buffer and generation zone lifecycle. No raw `editor.emit` calls.
- **Provider-neutral `ModelMessage`.** Uses the `ModelMessage` type from `@pen/core` with structured `ModelMessagePart[]` content for tool calls and results, rather than provider-specific message shapes.
- **Per-tool error circuit breaker.** Tracks consecutive errors per tool name. After 3 consecutive failures for the same tool, it's excluded from the available tools list in subsequent iterations. Counter resets on success.
- **Step limit.** Default 10 steps prevents runaway loops. Configurable per invocation.
- **Text streaming.** When the model produces text deltas, the loop enters writing mode. `beginStreaming` / `appendDelta` / `endStreaming` map to the `StreamingTarget` interface from Wave 3.
- **Tool result buffering.** `AsyncIterable` results from tools are buffered into arrays, matching the MCP bridge pattern from Wave 6.

---

## Module: `agentic/context-builder.ts` — ToolContext Factory

```typescript
import type { Editor, ToolContext, StreamingTarget, PenStreamPart } from '@pen/types';

export function buildToolContext(
  editor: Editor,
  zoneId: string,
  blockId: string,
  streamingTarget: StreamingTarget | null,
  onEmit?: (part: PenStreamPart) => void,
): ToolContext {
  return {
    editor,
    docId: 'default',
    emit(part) {
      onEmit?.(part);
    },
    insertBlock(blockType, props, position) {
      const id = crypto.randomUUID();
      editor.applyWithOrigin('ai', {
        type: 'insert-block', blockId: id, blockType, props, position,
      });
      return id;
    },
    updateBlock(bid, props) {
      editor.applyWithOrigin('ai', { type: 'update-block', blockId: bid, props });
    },
    deleteBlock(bid) {
      editor.applyWithOrigin('ai', { type: 'delete-block', blockId: bid });
    },
    beginStreaming(zid, bid) {
      editor.undoManager.stopCapturing();
      streamingTarget?.beginStreaming(zid, bid);
    },
    appendDelta(delta) {
      streamingTarget?.appendDelta(delta);
    },
    endStreaming(status) {
      streamingTarget?.endStreaming(status);
      editor.undoManager.stopCapturing();
    },
  } satisfies ToolContext;
}
```

All tool-context document writes are attributed to `origin: 'ai'`. Generation start/end explicitly call `undoManager.stopCapturing()` so every generation is grouped as a single undo/redo unit even when tools emit multiple operations.

---

## Module: `agentic/awareness.ts` — AI Awareness Publisher

```typescript
import type { Editor } from '@pen/types';
import type { AIAwarenessState } from '../types.js';

export function publishAwareness(
  editor: Editor,
  state: AIAwarenessState,
): void {
  const awareness = editor.internals.awareness;
  if (!awareness) return;

  awareness.setLocalState({
    ...awareness.getStates().get(awareness.clientID) ?? {},
    ai: state,
  });
}
```

---

## Module: `suggestions/ephemeral.ts` — Ephemeral Suggestions

Local-only ghost text. Not CRDT-synced. Rendered as decorations.

```typescript
import type { Editor, Unsubscribe, InlineDecoration } from '@pen/types';
import type { EphemeralSuggestion } from '../types.js';

export class EphemeralSuggestionManager {
  private _current: EphemeralSuggestion | null = null;
  private _listeners = new Set<() => void>();

  get current(): EphemeralSuggestion | null { return this._current; }

  show(suggestion: EphemeralSuggestion): void {
    this._current = suggestion;
    this.notify();
  }

  dismiss(): void {
    if (!this._current) return;
    this._current = null;
    this.notify();
  }

  accept(editor: Editor): void {
    const s = this._current;
    if (!s) return;
    this._current = null;

    if (s.type === 'inline') {
      editor.apply([{
        type: 'insert-text',
        blockId: s.blockId,
        offset: s.offset,
        text: s.text,
      }], { origin: 'ai', undoGroup: true });
    } else if (s.type === 'block') {
      const newId = crypto.randomUUID();
      editor.apply([{
        type: 'insert-block',
        blockId: newId,
        blockType: s.blockType ?? 'paragraph',
        props: s.props ?? {},
        position: { after: s.blockId },
      }, {
        type: 'insert-text',
        blockId: newId,
        offset: 0,
        text: s.text,
      }], { origin: 'ai', undoGroup: true });
    }

    this.notify();
  }

  toDecorations(): InlineDecoration[] {
    const s = this._current;
    if (!s || s.type !== 'inline') return [];

    return [{
      type: 'inline',
      blockId: s.blockId,
      from: s.offset,
      to: s.offset,
      attributes: {
        class: 'pen-ephemeral-suggestion',
        'data-suggestion-text': s.text,
        'data-suggestion-type': 'inline',
      },
    }];
  }

  onChange(callback: () => void): Unsubscribe {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }

  private notify(): void {
    for (const cb of this._listeners) cb();
  }
}
```

**Only one active suggestion.** Calling `show()` replaces any existing suggestion. This matches GitHub Copilot behavior — one completion at a time.

---

## Module: `suggestions/persistent.ts` — Persistent Suggestion Operations

CRDT-native suggestion marks. Reads and writes `suggestion` system mark attributes on `Y.Text`.

```typescript
import type { Editor, BlockHandle } from '@pen/types';
import type { PersistentSuggestion } from '../types.js';

export function readSuggestionsFromBlock(
  editor: Editor,
  blockId: string,
): PersistentSuggestion[] {
  const handle = editor.getBlock(blockId);
  if (!handle) return [];

  const ytext = getYText(editor, blockId);
  if (!ytext) return [];

  const suggestions: PersistentSuggestion[] = [];
  const deltas = ytext.toDelta();
  let offset = 0;

  for (const delta of deltas) {
    const len = typeof delta.insert === 'string' ? delta.insert.length : 1;
    const suggestionAttr = delta.attributes?.suggestion;

    if (suggestionAttr && typeof suggestionAttr === 'object') {
      const s = suggestionAttr as Record<string, unknown>;
      suggestions.push({
        id: s.id as string,
        action: s.action as 'insert' | 'delete',
        author: s.author as string,
        authorType: s.authorType as 'user' | 'ai',
        createdAt: s.createdAt as number,
        model: s.model as string | undefined,
        blockId,
        offset,
        length: len,
      });
    }

    offset += len;
  }

  return suggestions;
}

export function readAllSuggestions(editor: Editor): PersistentSuggestion[] {
  const suggestions: PersistentSuggestion[] = [];
  const blockOrder = editor.documentState.blockOrder;

  for (const blockId of blockOrder) {
    suggestions.push(...readSuggestionsFromBlock(editor, blockId));
  }

  return suggestions;
}

export function createSuggestionMark(
  action: 'insert' | 'delete',
  author: string,
  authorType: 'user' | 'ai',
  model?: string,
): Record<string, unknown> {
  return {
    suggestion: {
      id: crypto.randomUUID(),
      action,
      author,
      authorType,
      createdAt: Date.now(),
      model,
    },
  };
}

function getYText(editor: Editor, blockId: string): any {
  const adapter = editor.internals.adapter;
  const doc = editor.internals.crdtDoc;
  const ydoc = adapter.raw(doc);
  const blocks = ydoc.getMap('blocks');
  const blockMap = blocks.get(blockId);
  return blockMap?.get('content') ?? null;
}
```

---

## Module: `suggestions/suggest-mode.ts` — Suggest Mode Interceptor

When suggest mode is active, `editor.onBeforeApply()` intercepts ops. Text inserts get suggestion marks. Text deletes mark original text instead of removing it.

```typescript
import type { Editor, DocumentOp } from '@pen/types';
import { createSuggestionMark } from './persistent.js';
import type { BlockSuggestionMeta } from '../types.js';

export function interceptApplyForSuggestMode(
  ops: DocumentOp[],
  editor: Editor,
  author: string,
  authorType: 'user' | 'ai',
  model?: string,
): DocumentOp[] {
  const intercepted: DocumentOp[] = [];

  for (const op of ops) {
    switch (op.type) {
      case 'insert-text': {
        const marks = {
          ...(op.marks ?? {}),
          ...createSuggestionMark('insert', author, authorType, model),
        };
        intercepted.push({ ...op, marks });
        break;
      }

      case 'delete-text': {
        intercepted.push({
          type: 'format-text',
          blockId: op.blockId,
          offset: op.offset,
          length: op.length,
          marks: createSuggestionMark('delete', author, authorType, model),
        });
        break;
      }

      case 'insert-block': {
        intercepted.push(op);
        const meta: BlockSuggestionMeta = {
          id: crypto.randomUUID(),
          action: 'insert-block',
          author,
          authorType,
          createdAt: Date.now(),
          model,
        };
        intercepted.push({
          type: 'set-meta',
          blockId: op.blockId,
          namespace: 'suggestion',
          data: meta,
        });
        break;
      }

      case 'delete-block': {
        const meta: BlockSuggestionMeta = {
          id: crypto.randomUUID(),
          action: 'delete-block',
          author,
          authorType,
          createdAt: Date.now(),
          model,
        };
        intercepted.push({
          type: 'set-meta',
          blockId: op.blockId,
          namespace: 'suggestion',
          data: meta,
        });
        break;
      }

      case 'move-block': {
        const handle = editor.getBlock(op.blockId);
        const meta: BlockSuggestionMeta = {
          id: crypto.randomUUID(),
          action: 'move-block',
          author,
          authorType,
          createdAt: Date.now(),
          model,
          previousState: {
            position: handle?.prev?.id ? { after: handle.prev.id } : { index: 0 },
          },
        };
        intercepted.push(op);
        intercepted.push({
          type: 'set-meta',
          blockId: op.blockId,
          namespace: 'suggestion',
          data: meta,
        });
        break;
      }

      case 'convert-block': {
        const handle = editor.getBlock(op.blockId);
        const meta: BlockSuggestionMeta = {
          id: crypto.randomUUID(),
          action: 'convert-block',
          author,
          authorType,
          createdAt: Date.now(),
          model,
          previousState: {
            type: handle?.type,
            props: handle ? { ...handle.props } : undefined,
          },
        };
        intercepted.push(op);
        intercepted.push({
          type: 'set-meta',
          blockId: op.blockId,
          namespace: 'suggestion',
          data: meta,
        });
        break;
      }

      default:
        intercepted.push(op);
    }
  }

  return intercepted;
}
```

**Text deletions become format operations.** Instead of deleting text, suggest mode applies a `suggestion { action: 'delete' }` mark to the range. The text remains in the CRDT, visible to all collaborators as "pending deletion." On accept, the marked text is deleted. On reject, the mark is removed.

---

## Module: `suggestions/accept-reject.ts` — Accept/Reject Lifecycle

Accept and reject are CRDT operations, not undo-stack operations. They work across sessions and collaborators.

> **Concurrent accept/reject resolution.** Two users can simultaneously accept and reject the same suggestion. See Wave 1, "Conflict Resolution Semantics", Scenario 5 for the full analysis. The guard below ensures only the first operation takes effect.

```typescript
import type { Editor, DocumentOp } from '@pen/types';
import { readSuggestionsFromBlock } from './persistent.js';
import type { BlockSuggestionMeta, PersistentSuggestion } from '../types.js';

export function acceptSuggestion(
  editor: Editor,
  suggestionId: string,
): boolean {
  if (!isSuggestionPending(editor, suggestionId)) return false;
  const ops = buildAcceptOps(editor, suggestionId);
  if (ops.length === 0) return false;
  editor.apply(ops, { origin: 'user', undoGroup: true });
  return true;
}

export function rejectSuggestion(
  editor: Editor,
  suggestionId: string,
): boolean {
  if (!isSuggestionPending(editor, suggestionId)) return false;
  const ops = buildRejectOps(editor, suggestionId);
  if (ops.length === 0) return false;
  editor.apply(ops, { origin: 'user', undoGroup: true });
  return true;
}

export function acceptAllSuggestions(editor: Editor): void {
  const allSuggestions = getAllSuggestionIds(editor);
  for (const id of allSuggestions) {
    acceptSuggestion(editor, id);
  }
}

export function rejectAllSuggestions(editor: Editor): void {
  const allSuggestions = getAllSuggestionIds(editor);
  for (const id of allSuggestions) {
    rejectSuggestion(editor, id);
  }
}

function isSuggestionPending(editor: Editor, suggestionId: string): boolean {
  const blockOrder = editor.documentState.blockOrder;

  for (const blockId of blockOrder) {
    const blockMeta = editor.getBlock(blockId)?.meta('suggestion') as BlockSuggestionMeta | null;
    if (blockMeta?.id === suggestionId) return true;

    const suggestions = readSuggestionsFromBlock(editor, blockId);
    if (suggestions.some(s => s.id === suggestionId)) return true;
  }

  return false;
}

function buildAcceptOps(editor: Editor, suggestionId: string): DocumentOp[] {
  const ops: DocumentOp[] = [];
  const blockOrder = editor.documentState.blockOrder;

  for (const blockId of blockOrder) {
    const blockMeta = editor.getBlock(blockId)?.meta('suggestion') as BlockSuggestionMeta | null;
    if (blockMeta?.id === suggestionId) {
      return buildBlockAcceptOps(blockMeta, blockId);
    }

    const suggestions = readSuggestionsFromBlock(editor, blockId);
    const matching = suggestions.filter(s => s.id === suggestionId);
    if (matching.length === 0) continue;

    for (const s of matching.sort((a, b) => b.offset - a.offset)) {
      if (s.action === 'insert') {
        ops.push({
          type: 'format-text',
          blockId,
          offset: s.offset,
          length: s.length,
          marks: { suggestion: null },
        });
      } else if (s.action === 'delete') {
        ops.push({
          type: 'delete-text',
          blockId,
          offset: s.offset,
          length: s.length,
        });
      }
    }
  }

  return ops;
}

function buildRejectOps(editor: Editor, suggestionId: string): DocumentOp[] {
  const ops: DocumentOp[] = [];
  const blockOrder = editor.documentState.blockOrder;

  for (const blockId of blockOrder) {
    const blockMeta = editor.getBlock(blockId)?.meta('suggestion') as BlockSuggestionMeta | null;
    if (blockMeta?.id === suggestionId) {
      return buildBlockRejectOps(blockMeta, blockId, editor);
    }

    const suggestions = readSuggestionsFromBlock(editor, blockId);
    const matching = suggestions.filter(s => s.id === suggestionId);
    if (matching.length === 0) continue;

    for (const s of matching.sort((a, b) => b.offset - a.offset)) {
      if (s.action === 'insert') {
        ops.push({
          type: 'delete-text',
          blockId,
          offset: s.offset,
          length: s.length,
        });
      } else if (s.action === 'delete') {
        ops.push({
          type: 'format-text',
          blockId,
          offset: s.offset,
          length: s.length,
          marks: { suggestion: null },
        });
      }
    }
  }

  return ops;
}

function buildBlockAcceptOps(meta: BlockSuggestionMeta, blockId: string): DocumentOp[] {
  switch (meta.action) {
    case 'insert-block':
      return [{ type: 'set-meta', blockId, namespace: 'suggestion', data: null }];
    case 'delete-block':
      return [{ type: 'delete-block', blockId }];
    case 'move-block':
      return [{ type: 'set-meta', blockId, namespace: 'suggestion', data: null }];
    case 'convert-block':
      return [{ type: 'set-meta', blockId, namespace: 'suggestion', data: null }];
    default:
      return [];
  }
}

function buildBlockRejectOps(
  meta: BlockSuggestionMeta,
  blockId: string,
  editor: Editor,
): DocumentOp[] {
  switch (meta.action) {
    case 'insert-block':
      return [{ type: 'delete-block', blockId }];
    case 'delete-block':
      return [{ type: 'set-meta', blockId, namespace: 'suggestion', data: null }];
    case 'move-block':
      if (meta.previousState?.position) {
        return [
          { type: 'move-block', blockId, position: meta.previousState.position },
          { type: 'set-meta', blockId, namespace: 'suggestion', data: null },
        ];
      }
      return [{ type: 'set-meta', blockId, namespace: 'suggestion', data: null }];
    case 'convert-block':
      if (meta.previousState?.type) {
        return [
          { type: 'convert-block', blockId, newType: meta.previousState.type, newProps: meta.previousState.props ?? {} },
          { type: 'set-meta', blockId, namespace: 'suggestion', data: null },
        ];
      }
      return [{ type: 'set-meta', blockId, namespace: 'suggestion', data: null }];
    default:
      return [];
  }
}

function getAllSuggestionIds(editor: Editor): string[] {
  const ids = new Set<string>();
  const blockOrder = editor.documentState.blockOrder;

  for (const blockId of blockOrder) {
    const blockMeta = editor.getBlock(blockId)?.meta('suggestion') as BlockSuggestionMeta | null;
    if (blockMeta?.id) ids.add(blockMeta.id);

    for (const s of readSuggestionsFromBlock(editor, blockId)) {
      ids.add(s.id);
    }
  }

  return [...ids];
}
```

**Offset ordering.** When building ops for multiple suggestion ranges within a block, process from highest offset to lowest. This ensures earlier ops don't shift the offsets of later ones.

---

## Module: `decorations/track-changes.ts` — CRDT-Derived Decorations

Reads `suggestion` attributes from `Y.Text` deltas and produces decorations for rendering.

```typescript
import type { Editor, InlineDecoration, BlockDecoration, DecorationSet } from '@pen/types';
import type { BlockSuggestionMeta } from '../types.js';

export function buildTrackChangesDecorations(
  editor: Editor,
): (InlineDecoration | BlockDecoration)[] {
  const decorations: (InlineDecoration | BlockDecoration)[] = [];
  const blockOrder = editor.documentState.blockOrder;

  for (const blockId of blockOrder) {
    const blockMeta = editor.getBlock(blockId)?.meta('suggestion') as BlockSuggestionMeta | undefined;
    if (blockMeta) {
      decorations.push({
        type: 'block',
        blockId,
        attributes: {
          class: `pen-block-suggestion pen-block-suggestion-${blockMeta.action}`,
          'data-suggestion-id': blockMeta.id,
          'data-suggestion-action': blockMeta.action,
          'data-suggestion-author-type': blockMeta.authorType,
        },
      });
    }

    const ytext = getYText(editor, blockId);
    if (!ytext) continue;

    const deltas = ytext.toDelta();
    let offset = 0;

    for (const delta of deltas) {
      const len = typeof delta.insert === 'string' ? delta.insert.length : 1;
      const suggestion = delta.attributes?.suggestion;

      if (suggestion && typeof suggestion === 'object') {
        const s = suggestion as Record<string, unknown>;
        decorations.push({
          type: 'inline',
          blockId,
          from: offset,
          to: offset + len,
          attributes: {
            class: `pen-suggestion-${s.action}`,
            'data-suggestion-id': s.id as string,
            'data-suggestion-action': s.action as string,
            'data-suggestion-author': s.author as string,
            'data-suggestion-author-type': s.authorType as string,
          },
        });
      }

      offset += len;
    }
  }

  return decorations;
}

function getYText(editor: Editor, blockId: string): any {
  try {
    const adapter = editor.internals.adapter;
    const doc = editor.internals.crdtDoc;
    const ydoc = adapter.raw(doc);
    const blocks = ydoc.getMap('blocks');
    return blocks.get(blockId)?.get('content') ?? null;
  } catch {
    return null;
  }
}
```

---

## Module: `commands/registry.ts` — AI Command Registry

```typescript
import type { AICommandBinding, AICommandContext, AICommandGuard } from '../types.js';

export class AICommandRegistry {
  private _commands: AICommandBinding[] = [];

  register(command: AICommandBinding): void {
    const existing = this._commands.findIndex(c => c.id === command.id);
    if (existing >= 0) {
      this._commands[existing] = command;
    } else {
      this._commands.push(command);
    }
  }

  unregister(id: string): void {
    this._commands = this._commands.filter(c => c.id !== id);
  }

  list(ctx?: AICommandContext): readonly AICommandBinding[] {
    if (!ctx) return this._commands;
    return this._commands.filter(c => !c.guard || c.guard(ctx));
  }

  resolve(id: string): AICommandBinding | null {
    return this._commands.find(c => c.id === id) ?? null;
  }

  resolvePrompt(command: AICommandBinding, ctx: AICommandContext): string {
    return typeof command.prompt === 'function'
      ? command.prompt(ctx)
      : command.prompt;
  }
}
```

---

## Module: `commands/guards.ts` — Context Predicates

```typescript
import type { AICommandGuard, AICommandContext } from '../types.js';

export const hasSelection: AICommandGuard = (ctx) =>
  ctx.selection !== null && ctx.selection.type === 'text' &&
  ctx.selectedText.length > 0;

export const isCollapsed: AICommandGuard = (ctx) =>
  ctx.selection !== null && ctx.selection.type === 'text' &&
  ctx.selectedText.length === 0;

export const blockTypeIs = (...types: string[]): AICommandGuard => (ctx) =>
  ctx.blockType !== null && types.includes(ctx.blockType);

export const blockTypeIsNot = (...types: string[]): AICommandGuard => (ctx) =>
  ctx.blockType !== null && !types.includes(ctx.blockType);

export const prefixMatches = (pattern: RegExp): AICommandGuard => (ctx) => {
  if (!ctx.blockId) return false;
  const text = ctx.editor.getBlock(ctx.blockId)?.textContent() ?? '';
  return pattern.test(text);
};

export const and = (...guards: AICommandGuard[]): AICommandGuard => (ctx) =>
  guards.every(g => g(ctx));

export const or = (...guards: AICommandGuard[]): AICommandGuard => (ctx) =>
  guards.some(g => g(ctx));
```

---

## Module: `commands/default-commands.ts` — Built-in Commands

```typescript
import type { AICommandBinding } from '../types.js';
import { hasSelection, isCollapsed, blockTypeIs } from './guards.js';

export const defaultAICommands: AICommandBinding[] = [
  {
    id: 'ai:rewrite',
    label: 'Rewrite',
    description: 'Rewrite the selected text',
    group: 'edit',
    prompt: (ctx) => `Rewrite the following text while preserving its meaning:\n\n${ctx.selectedText}`,
    guard: hasSelection,
  },
  {
    id: 'ai:continue',
    label: 'Continue writing',
    description: 'Continue writing from the current position',
    group: 'generate',
    prompt: (ctx) => {
      const block = ctx.blockId ? ctx.editor.getBlock(ctx.blockId) : null;
      const text = block?.textContent() ?? '';
      return `Continue writing from where this text leaves off:\n\n${text}`;
    },
    guard: isCollapsed,
  },
  {
    id: 'ai:summarize',
    label: 'Summarize',
    description: 'Summarize the selected text',
    group: 'edit',
    prompt: (ctx) => `Summarize the following text concisely:\n\n${ctx.selectedText}`,
    guard: hasSelection,
  },
  {
    id: 'ai:fix-grammar',
    label: 'Fix grammar',
    description: 'Fix grammar and spelling',
    group: 'edit',
    prompt: (ctx) => `Fix grammar and spelling in the following text, preserving the original meaning and tone:\n\n${ctx.selectedText}`,
    guard: hasSelection,
  },
  {
    id: 'ai:simplify',
    label: 'Simplify',
    description: 'Make the text simpler and more concise',
    group: 'edit',
    prompt: (ctx) => `Simplify the following text. Make it clearer and more concise:\n\n${ctx.selectedText}`,
    guard: hasSelection,
  },
  {
    id: 'ai:expand',
    label: 'Expand',
    description: 'Expand the text with more detail',
    group: 'generate',
    prompt: (ctx) => `Expand the following text with more detail and examples:\n\n${ctx.selectedText}`,
    guard: hasSelection,
  },
  {
    id: 'ai:translate',
    label: 'Translate',
    description: 'Translate to another language',
    group: 'edit',
    prompt: (ctx) => `Translate the following text to the language the user specifies:\n\n${ctx.selectedText}`,
    guard: hasSelection,
  },
];
```

---

## Primitives

All primitives follow the Radix-style compound component pattern from Wave 5. Unstyled, `data-*` attributes for consumer styling, `asChild` support, ref forwarding.

### `Pen.AI.Root`

Context provider. Accepts `ModelAdapter`. Makes AI state available to all child primitives.

```typescript
interface AIRootProps {
  model?: ModelAdapter;
  commands?: AICommandBinding[];
  suggestMode?: boolean;
  onSuggestModeChange?: (mode: boolean) => void;
  children: React.ReactNode;
}

// Data attributes:
// [data-pen-ai-root]
// [data-connected]      - model adapter is available
// [data-generating]     - AI generation is active
// [data-suggest-mode]   - suggest mode is enabled
```

### `Pen.AI.GenerationZone`

Compound root for generation UI. Auto-connects to the active generation's state.

```typescript
interface GenerationZoneProps {
  children: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-ai-generation-zone]
// [data-status]        - 'streaming' | 'complete' | 'cancelled' | 'error'
// [data-streaming]     - true when actively streaming
```

### `Pen.AI.ActionBar`

Post-generation action buttons. `Accept`, `Reject`, and `Retry` are sub-components.

- **Accept** — Commits the generation. In suggest mode: strips suggestion marks from inserts, deletes delete-marked text. In normal mode: no-op (content is already committed).
- **Reject** — Reverts the generation via undo.
- **Retry** — Reverts and re-runs with the same prompt.

### `Pen.AI.Suggestion`

Ephemeral ghost text. Renders inline completion suggestion.

```typescript
interface SuggestionProps {
  acceptKey?: string;
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-ai-suggestion]
// [data-type]           - 'inline' | 'block'
// [data-accepted]       - suggestion was accepted
// [data-visible]        - suggestion is currently visible
```

### `Pen.AI.TrackChanges`

Persistent suggestion rendering. Reads CRDT-derived decorations.

```typescript
interface TrackChangesProps {
  mode?: 'suggesting' | 'editing';
  onModeChange?: (mode: 'suggesting' | 'editing') => void;
  children?: React.ReactNode;
}

// Data attributes:
// [data-pen-ai-track-changes]
// [data-mode]              - 'suggesting' | 'editing'
// [data-suggestion-count]  - number of active suggestions
```

### `Pen.AI.DiffView`

Inline or side-by-side diff view. Reads suggestion marks to compute diffs.

```typescript
interface DiffViewProps {
  mode?: 'inline' | 'side-by-side';
  children?: React.ReactNode;
}

// Data attributes:
// [data-pen-ai-diff-view]
// [data-has-changes]  - document has active suggestions
// [data-mode]         - 'inline' | 'side-by-side'
```

---

## View Resolution: Raw vs Resolved

When track changes are active, `Y.Text` contains both current and suggested content. All read APIs define which view they operate on:

| API | Default view | Notes |
|---|---|---|
| `textContent()` | raw | Includes all text (insert + delete marks) |
| `textContent({ resolved: true })` | resolved | Excludes `action: 'delete'`, strips suggestion marks from `action: 'insert'` |
| `length()` | raw | Raw character count |
| Selection offsets | raw | Field editor operates on raw text |
| `read_document` tool | resolved | LLM sees accepted view by default |
| `get_context` tool | resolved | LLM sees accepted view by default |
| Normalization Rule 3 | raw | Block with only delete-marked text is non-empty |

The `resolved` option is implemented on `BlockHandle`:

```typescript
textContent(options?: { resolved?: boolean }): string {
  if (!options?.resolved) return this.rawTextContent();

  const ytext = this.getYText();
  if (!ytext) return '';

  const deltas = ytext.toDelta();
  let result = '';
  for (const delta of deltas) {
    if (typeof delta.insert !== 'string') continue;
    if (delta.attributes?.suggestion?.action === 'delete') continue;
    result += delta.insert;
  }
  return result === '\u200B' ? '' : result;
}
```

---

## Dependencies

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@pen/react": "workspace:*",
    "react": "^19.0.0"
  },
  "peerDependencies": {
    "react": "^18.0.0 || ^19.0.0",
    "react-dom": "^18.0.0 || ^19.0.0"
  }
}
```

No external AI SDK dependency. The `ModelAdapter` interface accepts any provider.

---

## Key Decisions

1. **Ephemeral vs persistent suggestions are distinct systems.** Ephemeral suggestions are local decorations (never CRDT-synced). Persistent suggestions are CRDT-native system marks. They serve different use cases — ghost text completion vs reviewable tracked changes.

2. **Accept/reject are CRDT operations, not undo operations.** A suggestion created by User A can be accepted by User B days later. Undo only reverts local history; accept/reject operates on CRDT state directly.

3. **Suggest mode intercepts `editor.apply()`.** Text insertions get suggestion marks. Text deletions become format operations that mark text as "pending deletion" instead of removing it. Block-level operations write suggestion metadata to `meta.suggestion`.

4. **The agentic loop uses `stopCapturing()` boundaries.** Each generation is one undo group. User edits during streaming (in other blocks) are separate groups.

5. **AI awareness state follows the 7-step lifecycle from the spec.** idle → thinking → reading/writing/tool-calling → idle. Published to the CRDT awareness protocol for collaborative visibility.

6. **Command guards are composable predicates.** `and()`, `or()`, `hasSelection`, `blockTypeIs()`, etc. Commands are context-filtered at display time.

7. **Block-level suggestions use `meta.suggestion`.** Insert, delete, move, and convert block operations are tracked via the metadata channel, which is excluded from normalization (Rule 7).

8. **Offset-descending processing for multi-range operations.** When accepting or rejecting multiple suggestion ranges within a block, process from highest to lowest offset to avoid invalidating earlier ranges.

9. **Accept/reject are guarded by `isSuggestionPending`.** Before executing, both `acceptSuggestion` and `rejectSuggestion` verify the suggestion still exists in a `'pending'` state. If another collaborator already accepted or rejected the same suggestion (concurrent resolution via CRDT LWW), the function returns `false` and no-ops. This prevents the double-resolution race condition described in Wave 1, "Conflict Resolution Semantics", Scenario 5. The functions return `boolean` to signal whether the operation was applied.

10. **AI writes during active user editing abort the generation.** When the AI extension detects a concurrent user write to the active generation zone (via CRDT observer checking origin), it aborts the stream. User edits always take precedence over AI generation. See Wave 1, "Conflict Resolution Semantics", Scenario 4.

11. **Integration with Wave 8 history: AI generation snapshot trigger.** After `gen-end` with `status: 'complete'`, the AI extension publishes a `'ai:generation-complete'` event via `editor.on('diagnostic', { level: 'info', source: 'ai', code: 'GENERATION_COMPLETE', ... })`. Wave 8's `AutoSnapshotScheduler` listens for this event and triggers a snapshot with `trigger: 'ai-generation'`. This event-based coupling avoids direct package dependency between `@pen/ai` and `@pen/history`.

---

## Acceptance Criteria

1. AI command menu opens via `Pen.AI.Trigger`, shows available commands filtered by context guards.
2. Selecting a command streams the model's response into the document. Tokens appear in real-time.
3. `Pen.AI.ActionBar.Accept` commits the generation. `Reject` undoes it as a single undo step.
4. `Pen.AI.ActionBar.Retry` reverts and re-runs with the same prompt.
5. Ephemeral suggestion appears as ghost text (decoration). Tab accepts, writing to CRDT. Typing dismisses.
6. Only one ephemeral suggestion is active at a time.
7. Suggest mode toggle: when enabled, text inserts get `suggestion { action: 'insert' }` marks.
8. Suggest mode: text deletions mark text with `suggestion { action: 'delete' }` instead of removing.
9. Accept on persistent inline suggestion: strips suggestion marks from insert text, deletes delete-marked text.
10. Reject on persistent inline suggestion: deletes insert text, strips marks from delete text.
11. Block-level suggestions: insert-block creates block with `meta.suggestion`. Accept clears metadata. Reject deletes block.
12. Block-level suggestions: delete-block marks block with metadata. Accept deletes block. Reject clears metadata.
13. Block-level suggestions: convert-block stores previous type/props. Reject reverts to previous type.
14. Track changes marks render with correct `data-suggestion-*` attributes.
15. `Pen.AI.DiffView` renders inline insertions and deletions from suggestion marks.
16. Accept/reject works across sessions and collaborators (CRDT-native, not undo-stack).
17. Agentic loop: model calls tools, results feed back, loop continues until text-only response.
18. Agentic loop respects `maxSteps` limit.
19. AI awareness state transitions are published and visible to collaborators via `Pen.Collab.AIPresence`.
20. Generation creates separate undo group: Ctrl+Z after generation reverts the entire generation.
21. `textContent({ resolved: true })` returns text without delete-marked content and without suggestion marks on insert content.
22. `read_document` and `get_context` tools return resolved view by default.
23. Default AI commands (rewrite, continue, summarize, fix-grammar, simplify, expand, translate) are registered and context-filtered.
24. All primitives support `asChild`, forward refs, render no styles, and expose `data-*` attributes.
