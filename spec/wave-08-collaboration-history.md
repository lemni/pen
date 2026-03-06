# Wave 8 — Collaboration & Version History

**Milestone:** M1 · **Packages:** `@pen/collab`, `@pen/history` · **Depends on:** M0 (Waves 0-6), Wave 7

---

## Goal

Ship real-time collaboration primitives (remote cursors, presence indicators, WebSocket sync provider) and snapshot-based version history with per-character attribution. After this wave, multiple users can co-edit a document with visible cursors, browse historical snapshots, and see who wrote each character.

---

## File Structure

### `@pen/collab`

```
packages/extensions/collab/src/
├── extension.ts                defineExtension — entry point
├── sync/
│   ├── websocket-provider.ts   WebSocket sync provider (y-websocket compatible)
│   ├── reconnect.ts            Reconnection state machine (exponential backoff)
│   └── awareness-protocol.ts   Awareness encode/decode (y-protocols/awareness wrapper)
├── presence/
│   ├── cursor-manager.ts       Remote cursor state management
│   ├── selection-manager.ts    Remote selection state management
│   ├── identity-map.ts         ClientIdentityMap — clientID → user metadata
│   └── color-assignment.ts     Deterministic color assignment from userId
├── decorations/
│   ├── remote-cursors.ts       CRDT-derived cursor decorations
│   ├── remote-selections.ts    CRDT-derived selection decorations
│   └── ai-presence.ts          AI agent presence decorations
├── primitives/
│   ├── root.tsx                Pen.Collab.Root — context provider
│   ├── cursors.tsx             Pen.Collab.RemoteCursors
│   ├── cursor.tsx              Pen.Collab.RemoteCursor
│   ├── selections.tsx          Pen.Collab.RemoteSelections
│   ├── selection.tsx           Pen.Collab.RemoteSelection
│   ├── presence-list.tsx       Pen.Collab.PresenceList
│   ├── presence-avatar.tsx     Pen.Collab.PresenceAvatar
│   ├── ai-presence.tsx         Pen.Collab.AIPresence
│   ├── connection-status.tsx   Pen.Collab.ConnectionStatus
│   └── index.ts                Barrel
├── hooks/
│   ├── use-collab.ts           useCollab() — connection state, peers
│   ├── use-remote-cursors.ts   useRemoteCursors() — list of remote cursor states
│   ├── use-presence.ts         usePresence() — local + remote presence
│   └── index.ts                Barrel
├── types.ts                    Collab-specific types
└── index.ts                    Package entry
```

### `@pen/history`

```
packages/extensions/history/src/
├── extension.ts                defineExtension — entry point
├── snapshots/
│   ├── snapshot-manager.ts     Create, list, restore snapshots
│   ├── auto-snapshot.ts        Auto-snapshot triggers (time, ops, sessions)
│   ├── snapshot-diff.ts        Compute diffs between two snapshots
│   └── storage.ts              In-memory PenPersistence impl for testing
├── attribution/
│   ├── character-attribution.ts  Per-character attribution from CRDT metadata
│   ├── blame-view.ts             Build blame data for a block
│   └── identity-resolver.ts      Resolve clientID to user name/color
├── primitives/
│   ├── root.tsx                Pen.History.Root
│   ├── timeline.tsx            Pen.History.Timeline
│   ├── entry.tsx               Pen.History.Entry
│   ├── snapshot-diff.tsx       Pen.History.SnapshotDiff
│   ├── blame-gutter.tsx        Pen.History.BlameGutter
│   ├── restore-button.tsx      Pen.History.RestoreButton
│   └── index.ts                Barrel
├── hooks/
│   ├── use-history.ts          useHistory() — snapshot list, active snapshot
│   ├── use-attribution.ts     useAttribution() — per-character blame
│   └── index.ts                Barrel
├── types.ts                    History-specific types
└── index.ts                    Package entry
```

### Import DAG

```
@pen/collab:
  types.ts                         ← (@pen/core)
  sync/websocket-provider.ts       ← sync/reconnect.ts, sync/awareness-protocol.ts, types.ts
  sync/reconnect.ts                ← types.ts
  sync/awareness-protocol.ts       ← types.ts
  presence/cursor-manager.ts       ← types.ts, sync/awareness-protocol.ts
  presence/selection-manager.ts    ← types.ts, sync/awareness-protocol.ts
  presence/identity-map.ts         ← types.ts
  presence/color-assignment.ts     ← (standalone)
  decorations/remote-cursors.ts    ← presence/cursor-manager.ts
  decorations/remote-selections.ts ← presence/selection-manager.ts
  decorations/ai-presence.ts       ← presence/cursor-manager.ts
  extension.ts                     ← sync/*, presence/*, decorations/*
  primitives/*                     ← hooks/*, extension.ts
  hooks/*                          ← extension.ts, types.ts

@pen/history:
  types.ts                            ← (@pen/core)
  snapshots/snapshot-manager.ts        ← snapshots/storage.ts, types.ts, (@pen/core)
  snapshots/auto-snapshot.ts           ← snapshots/snapshot-manager.ts, types.ts
  snapshots/snapshot-diff.ts           ← types.ts, (@pen/core)
  snapshots/storage.ts                 ← types.ts
  attribution/character-attribution.ts ← types.ts, (@pen/core)
  attribution/blame-view.ts            ← attribution/character-attribution.ts, types.ts
  attribution/identity-resolver.ts     ← (@pen/collab types)
  extension.ts                         ← snapshots/*, attribution/*
  primitives/*                         ← hooks/*, extension.ts
  hooks/*                              ← extension.ts, types.ts
```

No cycles.

---

## Module: `@pen/collab — types.ts`

```typescript
import type { Editor, Unsubscribe, Position, SelectionState } from '@pen/types';

export interface CollabConfig {
  wsUrl?: string;
  roomId?: string;
  user: CollabUser;
  autoConnect?: boolean;
}

export interface CollabUser {
  id: string;
  name: string;
  color?: string;
  avatar?: string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'syncing' | 'error';

export interface RemoteCursorState {
  clientId: number;
  user: CollabUser;
  blockId: string;
  offset: number;
  clock: number;
}

export interface RemoteSelectionState {
  clientId: number;
  user: CollabUser;
  anchor: { blockId: string; offset: number };
  head: { blockId: string; offset: number };
  clock: number;
}

export interface PeerState {
  clientId: number;
  user: CollabUser;
  cursor: RemoteCursorState | null;
  selection: RemoteSelectionState | null;
  lastSeen: number;
}

export interface AwarenessChangeEvent {
  added: number[];
  updated: number[];
  removed: number[];
}
// Import from @pen/types — do not redeclare. This local definition exists for
// documentation clarity only; the implementation must use the type from @pen/types.

export interface SyncMessage {
  type: 'sync-step-1' | 'sync-step-2' | 'update' | 'awareness';
  protocolVersion: number;
  features?: string[];
  payload: Uint8Array;
}
```

---

## Module: `sync/websocket-provider.ts` — WebSocket Sync

```typescript
import type { Editor, CRDTDocument, Unsubscribe } from '@pen/types';
import type { CollabConfig, ConnectionState, SyncMessage } from '../types.js';
import { ReconnectStateMachine } from './reconnect.js';
import { encodeAwareness, decodeAwareness, applyAwareness } from './awareness-protocol.js';
import * as Y from 'yjs';

export class WebSocketSyncProvider {
  private ws: WebSocket | null = null;
  private reconnect: ReconnectStateMachine;
  private doc: CRDTDocument;
  private editor: Editor;
  private config: CollabConfig;
  private listeners = new Set<(state: ConnectionState) => void>();
  private _state: ConnectionState = 'disconnected';
  private cleanup: (() => void)[] = [];

  constructor(editor: Editor, doc: CRDTDocument, config: CollabConfig) {
    this.editor = editor;
    this.doc = doc;
    this.config = config;
    this.reconnect = new ReconnectStateMachine({
      onReconnect: () => this.connect(),
    });
  }

  get state(): ConnectionState { return this._state; }

  connect(): void {
    if (!this.config.wsUrl || !this.config.roomId) return;

    this.setState('connecting');
    const url = `${this.config.wsUrl}/${this.config.roomId}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      this.setState('syncing');
      this.sendSyncStep1();
      this.sendAwareness();
      this.reconnect.onSuccess();
    };

    this.ws.onmessage = (event) => {
      const data = new Uint8Array(event.data as ArrayBuffer);
      this.handleMessage(data);
    };

    this.ws.onclose = () => {
      this.setState('disconnected');
      this.reconnect.onDisconnect();
    };

    this.ws.onerror = () => {
      this.setState('error');
    };

    const unsubDoc = this.observeDocUpdates();
    const unsubAwareness = this.observeAwarenessUpdates();
    this.cleanup.push(unsubDoc, unsubAwareness);
  }

  disconnect(): void {
    this.reconnect.stop();
    for (const fn of this.cleanup) fn();
    this.cleanup = [];
    this.ws?.close();
    this.ws = null;
    this.setState('disconnected');
  }

  onStateChange(cb: (state: ConnectionState) => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private setState(state: ConnectionState): void {
    if (this._state === state) return;
    this._state = state;
    for (const cb of this.listeners) cb(state);
  }

  private sendSyncStep1(): void {
    const adapter = this.editor.internals.adapter;
    const ydoc = adapter.raw(this.doc);
    const sv = getStateVector(ydoc);
    this.send({ type: 'sync-step-1', protocolVersion: 1, payload: sv });
  }

  private sendAwareness(): void {
    const awareness = this.editor.internals.awareness;
    if (!awareness) return;
    const encoded = encodeAwareness(awareness);
    this.send({ type: 'awareness', protocolVersion: 1, payload: encoded });
  }

  private handleMessage(data: Uint8Array): void {
    const msgType = data[0];
    const protocolVersion = data[1] ?? 0;
    const payload = data.slice(2);

    if (protocolVersion > 1) {
      this.setState('error');
      return;
    }

    const adapter = this.editor.internals.adapter;
    const ydoc = adapter.raw(this.doc);

    switch (msgType) {
      case 0: {
        const update = encodeStateAsUpdate(ydoc, payload);
        this.send({ type: 'sync-step-2', protocolVersion: 1, payload: update });
        if (this._state === 'syncing') this.setState('connected');
        break;
      }
      case 1: {
        applyUpdate(ydoc, payload);
        if (this._state === 'syncing') this.setState('connected');
        break;
      }
      case 2: {
        applyUpdate(ydoc, payload);
        break;
      }
      case 3: {
        const awareness = this.editor.internals.awareness;
        if (awareness) applyAwareness(awareness, payload);
        break;
      }
    }
  }

  private observeDocUpdates(): Unsubscribe {
    const adapter = this.editor.internals.adapter;
    const ydoc = adapter.raw(this.doc);

    const handler = (update: Uint8Array, origin: any) => {
      if (origin === 'remote') return;
      this.send({ type: 'update', protocolVersion: 1, payload: update });
    };

    ydoc.on('update', handler);
    return () => ydoc.off('update', handler);
  }

  private observeAwarenessUpdates(): Unsubscribe {
    const awareness = this.editor.internals.awareness;
    if (!awareness) return () => {};

    const handler = (_changes: AwarenessChangeEvent) => {
      const encoded = encodeAwareness(awareness);
      this.send({ type: 'awareness', protocolVersion: 1, payload: encoded });
    };

    awareness.on('change', handler);
    return () => awareness.off('change', handler);
  }

  private send(msg: SyncMessage): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const typeMap: Record<string, number> = {
      'sync-step-1': 0, 'sync-step-2': 1, 'update': 2, 'awareness': 3,
    };
    const typeByte = typeMap[msg.type] ?? 0;
    const data = new Uint8Array(2 + msg.payload.length);
    data[0] = typeByte;
    data[1] = msg.protocolVersion;
    data.set(msg.payload, 2);
    this.ws.send(data);
  }
}

function getStateVector(ydoc: any): Uint8Array {
  return Y.encodeStateVector(ydoc);
}

function encodeStateAsUpdate(ydoc: any, sv: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(ydoc, sv);
}

function applyUpdate(ydoc: any, update: Uint8Array): void {
  Y.applyUpdate(ydoc, update, 'remote');
}
```

> **CRDT abstraction note:** This is one of the six `raw()` blast-radius modules (Spec Section 10.1). The WebSocket sync provider requires direct Y.Doc access for `Y.encodeStateAsUpdate`, `Y.applyUpdate`, and `Y.encodeStateVector`. This is acceptable because sync is transport-layer code tightly coupled to the CRDT wire format. A Loro adapter would have its own sync provider.

**Wire protocol.** Two-byte header + payload: `[typeByte][protocolVersion][payload...]`. Compatible with `y-websocket` payload semantics while adding explicit protocol negotiation. Message types: `0` = sync-step-1 (state vector), `1` = sync-step-2 (update), `2` = incremental update, `3` = awareness.

**Protocol envelope contract (M0 minimum).**

- `protocolVersion` is required on all `SyncMessage`s (current `1`).
- `features` is optional and advertises non-core capabilities.
- Unknown message types are ignored (do not crash or disconnect).
- Higher `protocolVersion` from a peer transitions state to `error` with `UNSUPPORTED_PROTOCOL` and surfaces a user-facing diagnostic.

**Failure behavior contract.**

| Case | Behavior |
|---|---|
| Unknown type byte | Ignore frame, continue session |
| Unsupported protocol version | Move connection to `error`, do not apply frame |
| Malformed payload | Drop frame, emit diagnostic, continue if possible |
| Reconnect exhausted | Transition to `error`, keep local editing active |

---

## Module: `sync/reconnect.ts` — Reconnection State Machine

```typescript
export interface ReconnectOptions {
  onReconnect: () => void;
  baseDelay?: number;
  maxDelay?: number;
  maxRetries?: number;
}

export class ReconnectStateMachine {
  private retryCount = 0;
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private opts: Required<ReconnectOptions>;

  constructor(opts: ReconnectOptions) {
    this.opts = {
      baseDelay: opts.baseDelay ?? 500,
      maxDelay: opts.maxDelay ?? 30_000,
      maxRetries: opts.maxRetries ?? Infinity,
      onReconnect: opts.onReconnect,
    };
  }

  onSuccess(): void {
    this.retryCount = 0;
  }

  onDisconnect(): void {
    if (this.stopped) return;
    if (this.retryCount >= this.opts.maxRetries) return;

    const delay = Math.min(
      this.opts.baseDelay * Math.pow(2, this.retryCount),
      this.opts.maxDelay,
    );
    const jitter = delay * (0.5 + Math.random() * 0.5);

    this.timerId = setTimeout(() => {
      this.retryCount++;
      this.opts.onReconnect();
    }, jitter);
  }

  stop(): void {
    this.stopped = true;
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
  }
}
```

**Jittered exponential backoff.** 500ms base, 30s cap, 50-100% jitter. Prevents thundering herd on server restarts.

---

## Module: `presence/cursor-manager.ts` — Remote Cursor State

Listens to awareness changes, extracts cursor states from `localState.cursor`, and notifies subscribers.

```typescript
import type { Unsubscribe } from '@pen/types';
import type { RemoteCursorState, CollabUser, AwarenessChangeEvent } from '../types.js';

export class RemoteCursorManager {
  private cursors = new Map<number, RemoteCursorState>();
  private listeners = new Set<() => void>();
  private localClientId: number;

  constructor(localClientId: number) {
    this.localClientId = localClientId;
  }

  handleAwarenessChange(
    states: Map<number, any>,
    _event: AwarenessChangeEvent,
  ): void {
    this.cursors.clear();

    for (const [clientId, state] of states) {
      if (clientId === this.localClientId) continue;
      if (!state?.cursor) continue;

      this.cursors.set(clientId, {
        clientId,
        user: state.user ?? { id: String(clientId), name: `User ${clientId}` },
        blockId: state.cursor.blockId,
        offset: state.cursor.offset,
        clock: state.cursor.clock ?? Date.now(),
      });
    }

    this.notify();
  }

  getCursors(): ReadonlyMap<number, RemoteCursorState> {
    return this.cursors;
  }

  onChange(cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}
```

---

## Module: `presence/selection-manager.ts` — Remote Selection State

Same pattern as cursor manager. Extracts selection ranges from awareness.

```typescript
import type { Unsubscribe } from '@pen/types';
import type { RemoteSelectionState, AwarenessChangeEvent } from '../types.js';

export class RemoteSelectionManager {
  private selections = new Map<number, RemoteSelectionState>();
  private listeners = new Set<() => void>();
  private localClientId: number;

  constructor(localClientId: number) {
    this.localClientId = localClientId;
  }

  handleAwarenessChange(
    states: Map<number, any>,
    _event: AwarenessChangeEvent,
  ): void {
    this.selections.clear();

    for (const [clientId, state] of states) {
      if (clientId === this.localClientId) continue;
      if (!state?.selection) continue;

      this.selections.set(clientId, {
        clientId,
        user: state.user ?? { id: String(clientId), name: `User ${clientId}` },
        anchor: state.selection.anchor,
        head: state.selection.head,
        clock: state.selection.clock ?? Date.now(),
      });
    }

    this.notify();
  }

  getSelections(): ReadonlyMap<number, RemoteSelectionState> {
    return this.selections;
  }

  onChange(cb: () => void): Unsubscribe {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}
```

---

## Module: `presence/identity-map.ts` — Client Identity Map

Maps Yjs `clientID` (number) to user metadata. Used for attribution and presence display. Populated from awareness states.

```typescript
import type { CollabUser } from '../types.js';

export class ClientIdentityMap {
  private map = new Map<number, CollabUser>();

  set(clientId: number, user: CollabUser): void {
    this.map.set(clientId, user);
  }

  get(clientId: number): CollabUser | null {
    return this.map.get(clientId) ?? null;
  }

  resolve(clientId: number): CollabUser {
    return this.map.get(clientId) ?? {
      id: String(clientId),
      name: `User ${clientId}`,
    };
  }

  updateFromAwareness(states: Map<number, any>): void {
    for (const [clientId, state] of states) {
      if (state?.user) {
        this.map.set(clientId, state.user);
      }
    }
  }

  entries(): ReadonlyMap<number, CollabUser> {
    return this.map;
  }
}
```

---

## Module: `presence/color-assignment.ts` — Deterministic Color Assignment

```typescript
const COLLAB_COLORS = [
  '#2563eb', '#dc2626', '#16a34a', '#ca8a04',
  '#9333ea', '#0891b2', '#e11d48', '#65a30d',
  '#7c3aed', '#059669', '#d97706', '#4f46e5',
];

export function assignColor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash + userId.charCodeAt(i)) | 0;
  }
  return COLLAB_COLORS[Math.abs(hash) % COLLAB_COLORS.length];
}
```

**Deterministic.** Same userId always produces the same color. No coordination needed.

---

## Module: `decorations/remote-cursors.ts` — Cursor Decorations

Converts remote cursor states into `InlineDecoration` objects that the reconciler renders.

```typescript
import type { InlineDecoration } from '@pen/types';
import type { RemoteCursorState } from '../types.js';

export function buildCursorDecorations(
  cursors: ReadonlyMap<number, RemoteCursorState>,
): InlineDecoration[] {
  const decorations: InlineDecoration[] = [];

  for (const [, cursor] of cursors) {
    decorations.push({
      type: 'inline',
      blockId: cursor.blockId,
      from: cursor.offset,
      to: cursor.offset,
      attributes: {
        class: 'pen-remote-cursor',
        style: `--pen-cursor-color: ${cursor.user.color ?? '#999'}`,
        'data-user-id': cursor.user.id,
        'data-user-name': cursor.user.name,
      },
    });
  }

  return decorations;
}
```

---

## Module: `decorations/remote-selections.ts` — Selection Decorations

```typescript
import type { InlineDecoration } from '@pen/types';
import type { RemoteSelectionState } from '../types.js';

export function buildSelectionDecorations(
  selections: ReadonlyMap<number, RemoteSelectionState>,
): InlineDecoration[] {
  const decorations: InlineDecoration[] = [];

  for (const [, sel] of selections) {
    if (sel.anchor.blockId !== sel.head.blockId) {
      continue;
    }

    const from = Math.min(sel.anchor.offset, sel.head.offset);
    const to = Math.max(sel.anchor.offset, sel.head.offset);
    if (from === to) continue;

    decorations.push({
      type: 'inline',
      blockId: sel.anchor.blockId,
      from,
      to,
      attributes: {
        class: 'pen-remote-selection',
        style: `--pen-selection-color: ${sel.user.color ?? '#999'}`,
        'data-user-id': sel.user.id,
        'data-user-name': sel.user.name,
      },
    });
  }

  return decorations;
}
```

**Cross-block selections.** Selections spanning multiple blocks need one decoration per block. The initial implementation handles same-block only. Cross-block support is added by iterating the blockOrder between anchor and head blocks.

---

## Module: `decorations/ai-presence.ts` — AI Agent Presence

```typescript
import type { BlockDecoration } from '@pen/types';
import type { RemoteCursorState } from '../types.js';

export function buildAIPresenceDecorations(
  states: Map<number, any>,
): BlockDecoration[] {
  const decorations: BlockDecoration[] = [];

  for (const [, state] of states) {
    const ai = state?.ai;
    if (!ai || ai.status === 'idle') continue;

    if (ai.activeBlockId) {
      decorations.push({
        type: 'block',
        blockId: ai.activeBlockId,
        attributes: {
          class: 'pen-ai-presence',
          'data-ai-status': ai.status,
          'data-ai-model': ai.model ?? 'unknown',
          'data-ai-tool': ai.activeTool?.name,
        },
      });
    }
  }

  return decorations;
}
```

---

## Collab Extension Entry Point

```typescript
import type { ExtensionDefinition, Editor, Unsubscribe, DecorationSet } from '@pen/types';
import { defineExtension } from '@pen/types';
import type { CollabConfig } from './types.js';
import { WebSocketSyncProvider } from './sync/websocket-provider.js';
import { RemoteCursorManager } from './presence/cursor-manager.js';
import { RemoteSelectionManager } from './presence/selection-manager.js';
import { ClientIdentityMap } from './presence/identity-map.js';
import { assignColor } from './presence/color-assignment.js';
import { buildCursorDecorations } from './decorations/remote-cursors.js';
import { buildSelectionDecorations } from './decorations/remote-selections.js';
import { buildAIPresenceDecorations } from './decorations/ai-presence.js';

export const collab = defineExtension<CollabConfig>({
  name: 'collab',

  setup(editor, config) {
    const awareness = editor.internals.awareness;
    if (!awareness) throw new Error('Collab extension requires CRDT awareness');

    const identityMap = new ClientIdentityMap();
    const cursorManager = new RemoteCursorManager(awareness.clientID);
    const selectionManager = new RemoteSelectionManager(awareness.clientID);

    if (!config.user.color) {
      config.user.color = assignColor(config.user.id);
    }

    awareness.setLocalState({
      user: config.user,
      cursor: null,
      selection: null,
    });

    const unsubAwareness = observeAwareness(awareness, (states, event) => {
      identityMap.updateFromAwareness(states);
      cursorManager.handleAwarenessChange(states, event);
      selectionManager.handleAwarenessChange(states, event);
    });

    const unsubSelection = editor.onSelectionChange((sel) => {
      if (!sel) {
        awareness.setLocalState({
          ...awareness.getStates().get(awareness.clientID),
          cursor: null,
          selection: null,
        });
        return;
      }

      if (sel.type === 'text') {
        awareness.setLocalState({
          ...awareness.getStates().get(awareness.clientID),
          cursor: { blockId: sel.anchor.blockId, offset: sel.anchor.offset, clock: Date.now() },
          selection: {
            anchor: { blockId: sel.anchor.blockId, offset: sel.anchor.offset },
            head: { blockId: sel.head.blockId, offset: sel.head.offset },
            clock: Date.now(),
          },
        });
      }
    });

    let provider: WebSocketSyncProvider | null = null;
    if (config.wsUrl && config.roomId) {
      provider = new WebSocketSyncProvider(editor, editor.internals.crdtDoc, config);
      if (config.autoConnect !== false) {
        provider.connect();
      }
    }

    const unsubCursors = cursorManager.onChange(() => editor.requestDecorationUpdate());
    const unsubSelections = selectionManager.onChange(() => editor.requestDecorationUpdate());

    return {
      decorations() {
        return [
          ...buildCursorDecorations(cursorManager.getCursors()),
          ...buildSelectionDecorations(selectionManager.getSelections()),
          ...buildAIPresenceDecorations(awareness.getStates()),
        ];
      },

      expose: {
        provider,
        identityMap,
        cursorManager,
        selectionManager,
      },

      destroy() {
        unsubAwareness();
        unsubSelection();
        unsubCursors();
        unsubSelections();
        provider?.disconnect();
      },
    };
  },
});

function observeAwareness(
  awareness: any,
  callback: (states: Map<number, any>, event: any) => void,
): Unsubscribe {
  const handler = (event: any) => {
    callback(awareness.getStates(), event);
  };
  awareness.on('change', handler);
  return () => awareness.off('change', handler);
}
```

---

## Collab Primitives

### `Pen.Collab.Root`

```typescript
interface CollabRootProps {
  children: React.ReactNode;
}

// Data attributes:
// [data-pen-collab-root]
// [data-connected]   - WebSocket is connected
// [data-peer-count]  - number of remote peers
```

### `Pen.Collab.RemoteCursors`

Container that renders all remote cursors. Renders one `RemoteCursor` per remote peer.

```typescript
interface RemoteCursorsProps {
  children?: React.ReactNode;
  renderCursor?: (cursor: RemoteCursorState) => React.ReactNode;
}
```

### `Pen.Collab.PresenceList`

Avatar list of all connected peers. Renders `PresenceAvatar` for each.

```typescript
interface PresenceListProps {
  children?: React.ReactNode;
  maxVisible?: number;
  renderAvatar?: (user: CollabUser) => React.ReactNode;
}

// Data attributes:
// [data-pen-collab-presence-list]
// [data-overflow-count]   - number of peers beyond maxVisible
```

### `Pen.Collab.AIPresence`

Shows which block an AI agent is working on and its current status.

```typescript
interface AIPresenceProps {
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-collab-ai-presence]
// [data-ai-status]
// [data-ai-model]
```

### `Pen.Collab.ConnectionStatus`

```typescript
interface ConnectionStatusProps {
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-collab-connection-status]
// [data-state]   - ConnectionState value
```

---

## Module: `@pen/history — types.ts`

```typescript
import type { CRDTDocument } from '@pen/types';

export interface VersionEntry {
  id: string;
  metadata: VersionMetadata;
  createdAt: number;
}

export interface VersionMetadata {
  label?: string;
  trigger: 'auto' | 'manual' | 'ai-generation' | 'import';
  clientId: number;
  timestamp: number;
}

export interface CharacterAttribution {
  blockId: string;
  offset: number;
  length: number;
  clientId: number;
  userId: string;
  userName: string;
  timestamp: number;
}

export interface BlameRange {
  from: number;
  to: number;
  author: { id: string; name: string; color?: string };
  timestamp: number;
}

export interface AutoSnapshotConfig {
  intervalMs?: number;
  opThreshold?: number;
  onSessionStart?: boolean;
  onAIGeneration?: boolean;
}
```

---

## Module: `snapshots/snapshot-manager.ts` — Snapshot CRUD

Creates, lists, and restores document snapshots. Delegates to the `CRDTAdapter` for binary snapshot creation and `PenPersistence` for storage.

```typescript
import type { Editor, CRDTDocument, PenPersistence } from '@pen/types';
import type { VersionEntry, VersionMetadata } from '../types.js';

export class SnapshotManager {
  private editor: Editor;
  private persistence: PenPersistence;
  private docId: string;

  constructor(editor: Editor, persistence: PenPersistence, docId: string) {
    this.editor = editor;
    this.persistence = persistence;
    this.docId = docId;
  }

  async createSnapshot(
    label?: string,
    trigger: VersionMetadata['trigger'] = 'manual',
  ): Promise<VersionEntry> {
    const adapter = this.editor.internals.adapter;
    const doc = this.editor.internals.crdtDoc;

    const snapshotData = adapter.createSnapshot(doc);
    const clientId = this.editor.clientId;

    const metadata: VersionMetadata = {
      label,
      trigger,
      clientId,
      timestamp: Date.now(),
    };

    await this.persistence.saveVersionSnapshot(this.docId, snapshotData, metadata);

    return {
      id: crypto.randomUUID(),
      metadata,
      createdAt: Date.now(),
    };
  }

  async restoreSnapshot(snapshotId: string): Promise<void> {
    const entry = await this.persistence.loadVersion(this.docId, snapshotId);
    if (!entry) throw new Error(`Snapshot ${snapshotId} not found`);

    await this.createSnapshot('Pre-restore auto-save', 'manual');

    const adapter = this.editor.internals.adapter;
    const doc = this.editor.internals.crdtDoc;
    adapter.restoreSnapshot(doc, entry.snapshot);
  }

  async listSnapshots(): Promise<VersionEntry[]> {
    const entries = await this.persistence.listVersions(this.docId);
    return entries.sort((a, b) => b.createdAt - a.createdAt);
  }
}
```

**Auto-save on restore.** Before restoring a snapshot, the current state is saved as a "Pre-restore auto-save" snapshot. This ensures the user can always return to the state before the restore.

---

## Module: `snapshots/auto-snapshot.ts` — Auto-Snapshot Triggers

```typescript
import type { Editor, Unsubscribe } from '@pen/types';
import type { AutoSnapshotConfig } from '../types.js';
import { SnapshotManager } from './snapshot-manager.js';

export class AutoSnapshotScheduler {
  private manager: SnapshotManager;
  private config: Required<AutoSnapshotConfig>;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private opsSinceSnapshot = 0;
  private cleanup: Unsubscribe[] = [];

  constructor(
    editor: Editor,
    manager: SnapshotManager,
    config: AutoSnapshotConfig = {},
  ) {
    this.manager = manager;
    this.config = {
      intervalMs: config.intervalMs ?? 5 * 60_000,
      opThreshold: config.opThreshold ?? 100,
      onSessionStart: config.onSessionStart ?? true,
      onAIGeneration: config.onAIGeneration ?? true,
    };

    if (this.config.onSessionStart) {
      this.manager.createSnapshot('Session start', 'auto').catch(err => {
        editor.on('diagnostic', () => {})  // swallow — handled internally
      });
    }

    this.timerId = setInterval(() => {
      this.manager.createSnapshot(undefined, 'auto').catch(() => {});
      this.opsSinceSnapshot = 0;
    }, this.config.intervalMs);

    const unsubOps = editor.on('documentChange', () => {
      this.opsSinceSnapshot++;
      if (this.opsSinceSnapshot >= this.config.opThreshold) {
        this.manager.createSnapshot(undefined, 'auto').catch(() => {});
        this.opsSinceSnapshot = 0;
      }
    });
    this.cleanup.push(unsubOps);
  }

  triggerAISnapshot(): void {
    if (this.config.onAIGeneration) {
      this.manager.createSnapshot('Pre-AI generation', 'ai-generation');
    }
  }

  destroy(): void {
    if (this.timerId) clearInterval(this.timerId);
    for (const fn of this.cleanup) fn();
  }
}
```

**Three auto-snapshot triggers:** Time-based (default 5 min), operation-count-based (default 100 ops), and session-start. Additionally, the AI extension can trigger a snapshot before each generation via `triggerAISnapshot()`.

**AI integration mechanism:** The `AutoSnapshotScheduler` does NOT import `@pen/ai` directly. Instead, it listens for the `'diagnostic'` event with `code: 'GENERATION_COMPLETE'` (emitted by Wave 7's AI extension after `gen-end`). This event-based coupling avoids a direct package dependency. Alternatively, the consuming application can call `triggerAISnapshot()` explicitly from its own integration code. The `setup()` method in the extension should subscribe:

```typescript
const unsubAI = editor.on('diagnostic', (event) => {
  if (event.code === 'GENERATION_COMPLETE' && this.config.onAIGeneration) {
    this.triggerAISnapshot();
  }
});
this.cleanup.push(unsubAI);
```

---

## Module: `snapshots/snapshot-diff.ts` — Diff Between Snapshots

```typescript
import type { Editor } from '@pen/types';

export interface SnapshotDiff {
  added: DiffBlock[];
  removed: DiffBlock[];
  modified: DiffModifiedBlock[];
  unchanged: string[];
}

export interface DiffBlock {
  blockId: string;
  blockType: string;
  textContent: string;
}

export interface DiffModifiedBlock {
  blockId: string;
  blockType: string;
  oldText: string;
  newText: string;
  inlineDiffs: InlineDiff[];
}

export interface InlineDiff {
  type: 'insert' | 'delete' | 'equal';
  text: string;
}

export function diffSnapshots(
  oldBlocks: Map<string, { type: string; text: string }>,
  newBlocks: Map<string, { type: string; text: string }>,
): SnapshotDiff {
  const added: DiffBlock[] = [];
  const removed: DiffBlock[] = [];
  const modified: DiffModifiedBlock[] = [];
  const unchanged: string[] = [];

  for (const [blockId, block] of newBlocks) {
    const old = oldBlocks.get(blockId);
    if (!old) {
      added.push({ blockId, blockType: block.type, textContent: block.text });
    } else if (old.text !== block.text || old.type !== block.type) {
      modified.push({
        blockId,
        blockType: block.type,
        oldText: old.text,
        newText: block.text,
        inlineDiffs: computeInlineDiffs(old.text, block.text),
      });
    } else {
      unchanged.push(blockId);
    }
  }

  for (const [blockId, block] of oldBlocks) {
    if (!newBlocks.has(blockId)) {
      removed.push({ blockId, blockType: block.type, textContent: block.text });
    }
  }

  return { added, removed, modified, unchanged };
}

function computeInlineDiffs(oldText: string, newText: string): InlineDiff[] {
  const diffs: InlineDiff[] = [];

  let i = 0;
  let j = 0;
  const commonPrefix = findCommonPrefix(oldText, newText);
  const commonSuffix = findCommonSuffix(
    oldText.slice(commonPrefix),
    newText.slice(commonPrefix),
  );

  if (commonPrefix > 0) {
    diffs.push({ type: 'equal', text: oldText.slice(0, commonPrefix) });
  }

  const oldMiddle = oldText.slice(commonPrefix, oldText.length - commonSuffix);
  const newMiddle = newText.slice(commonPrefix, newText.length - commonSuffix);

  if (oldMiddle) diffs.push({ type: 'delete', text: oldMiddle });
  if (newMiddle) diffs.push({ type: 'insert', text: newMiddle });

  if (commonSuffix > 0) {
    diffs.push({ type: 'equal', text: oldText.slice(oldText.length - commonSuffix) });
  }

  return diffs;
}

function findCommonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) return i;
  }
  return max;
}

function findCommonSuffix(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[a.length - 1 - i] !== b[b.length - 1 - i]) return i;
  }
  return max;
}
```

**Simple diff algorithm.** Common prefix/suffix + middle insert/delete. For M1, this is sufficient. A Myers diff or similar can be introduced later for fine-grained inline changes.

---

## Module: `attribution/character-attribution.ts` — Per-Character Attribution

Extracts attribution ranges via the CRDTAdapter. Each range identifies the `clientID` of the peer that inserted the characters.

```typescript
import type { Editor } from '@pen/types';
import type { CharacterAttribution } from '../types.js';

export function getCharacterAttribution(
  editor: Editor,
  blockId: string,
): CharacterAttribution[] {
  const adapter = editor.internals.adapter;
  const doc = editor.internals.crdtDoc;

  if (!adapter.getAttributionRanges) return [];

  const ranges = adapter.getAttributionRanges(doc, blockId);
  return ranges.map(range => ({
    blockId,
    offset: range.offset,
    length: range.length,
    clientId: range.clientId,
    userId: '',
    userName: '',
    timestamp: 0,
  }));
}
```

**Uses `CRDTAdapter.getAttributionRanges`.** Delegates to the adapter to extract per-character authorship ranges from the underlying CRDT. Adjacent characters from the same client are already merged by the adapter.

**Identity resolution is separate.** The attribution returns raw `clientId` values. The `ClientIdentityMap` from `@pen/collab` resolves these to user names and colors. This keeps `@pen/history` independent of the collab extension.

---

## Module: `attribution/blame-view.ts` — Blame Ranges

```typescript
import type { Editor } from '@pen/types';
import type { BlameRange, CharacterAttribution } from '../types.js';

export function buildBlameRanges(
  attributions: CharacterAttribution[],
  resolveUser: (clientId: number) => { id: string; name: string; color?: string },
): BlameRange[] {
  return attributions.map((a) => {
    const user = resolveUser(a.clientId);
    return {
      from: a.offset,
      to: a.offset + a.length,
      author: user,
      timestamp: a.timestamp,
    };
  });
}
```

---

## History Extension Entry Point

```typescript
import { defineExtension } from '@pen/types';
import type { PenPersistence } from '@pen/types';
import { SnapshotManager } from './snapshots/snapshot-manager.js';
import { AutoSnapshotScheduler } from './snapshots/auto-snapshot.js';
import type { AutoSnapshotConfig } from './types.js';

export interface HistoryConfig {
  persistence: PenPersistence;
  docId: string;
  autoSnapshot?: AutoSnapshotConfig;
}

export const history = defineExtension<HistoryConfig>({
  name: 'history',

  setup(editor, config) {
    const manager = new SnapshotManager(editor, config.persistence, config.docId);
    const scheduler = config.autoSnapshot !== false
      ? new AutoSnapshotScheduler(editor, manager, config.autoSnapshot as AutoSnapshotConfig)
      : null;

    return {
      expose: {
        manager,
        scheduler,
        createSnapshot: manager.createSnapshot.bind(manager),
        restoreSnapshot: manager.restoreSnapshot.bind(manager),
        listSnapshots: manager.listSnapshots.bind(manager),
      },

      destroy() {
        scheduler?.destroy();
      },
    };
  },
});
```

---

## History Primitives

### `Pen.History.Root`

Context provider. Exposes history state to children.

```typescript
interface HistoryRootProps {
  children: React.ReactNode;
}

// Data attributes:
// [data-pen-history-root]
// [data-viewing-snapshot]   - user is viewing a historical snapshot
// [data-snapshot-count]     - total number of snapshots
```

### `Pen.History.Timeline`

Renders a chronological list of snapshots. Each entry is a `Pen.History.Entry`.

```typescript
interface TimelineProps {
  children?: React.ReactNode;
  renderEntry?: (entry: VersionEntry) => React.ReactNode;
}

// Data attributes:
// [data-pen-history-timeline]
```

### `Pen.History.Entry`

Single snapshot entry in the timeline.

```typescript
interface EntryProps {
  entry: VersionEntry;
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-history-entry]
// [data-trigger]     - VersionMetadata trigger value
// [data-active]      - this snapshot is currently being viewed
// [data-client-id]
```

### `Pen.History.SnapshotDiff`

Renders the diff between two snapshots.

```typescript
interface SnapshotDiffProps {
  fromId: string;
  toId: string;
  mode?: 'inline' | 'side-by-side';
  children?: React.ReactNode;
}

// Data attributes:
// [data-pen-history-diff]
// [data-mode]
// [data-change-count]  - total added + removed + modified blocks
```

### `Pen.History.BlameGutter`

Per-block blame gutter showing character attribution ranges.

```typescript
interface BlameGutterProps {
  blockId: string;
  children?: React.ReactNode;
}

// Data attributes:
// [data-pen-history-blame-gutter]
// [data-author-count]   - distinct authors for this block
```

### `Pen.History.RestoreButton`

Restores a selected snapshot.

```typescript
interface RestoreButtonProps {
  snapshotId: string;
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-history-restore]
// [data-restoring]   - restore is in progress
```

---

## Local Cursor Synchronization

Awareness updates for the local cursor are published on every selection change. The extension listens to `editor.onSelectionChange()` and writes:

```typescript
{
  cursor: { blockId, offset, clock },
  selection: { anchor: { blockId, offset }, head: { blockId, offset }, clock },
}
```

Remote peers receive these via awareness protocol. The `clock` field is used to determine freshness — if two updates arrive out of order, the higher clock wins.

---

## Cross-Block Selection Decorations (Follow-up)

The initial `buildSelectionDecorations` only handles same-block selections. Cross-block selections require:

1. Find all blocks between `anchor.blockId` and `head.blockId` in `blockOrder`.
2. For the anchor block: decoration from anchor offset to end of text.
3. For middle blocks: full-block decoration.
4. For the head block: decoration from 0 to head offset.

```typescript
export function buildCrossBlockSelectionDecorations(
  selection: RemoteSelectionState,
  blockOrder: readonly string[],
  getBlockLength: (blockId: string) => number,
): InlineDecoration[] {
  const anchorIdx = blockOrder.indexOf(selection.anchor.blockId);
  const headIdx = blockOrder.indexOf(selection.head.blockId);
  if (anchorIdx < 0 || headIdx < 0) return [];

  const startIdx = Math.min(anchorIdx, headIdx);
  const endIdx = Math.max(anchorIdx, headIdx);
  const isForward = anchorIdx <= headIdx;

  const decorations: InlineDecoration[] = [];
  const attributes = {
    class: 'pen-remote-selection',
    style: `--pen-selection-color: ${selection.user.color ?? '#999'}`,
    'data-user-id': selection.user.id,
  };

  for (let i = startIdx; i <= endIdx; i++) {
    const blockId = blockOrder[i];
    const len = getBlockLength(blockId);

    let from: number, to: number;
    if (i === startIdx) {
      from = isForward ? selection.anchor.offset : selection.head.offset;
      to = len;
    } else if (i === endIdx) {
      from = 0;
      to = isForward ? selection.head.offset : selection.anchor.offset;
    } else {
      from = 0;
      to = len;
    }

    if (from !== to) {
      decorations.push({ type: 'inline', blockId, from, to, attributes });
    }
  }

  return decorations;
}
```

---

## Dependencies

### `@pen/collab`

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

No dependency on `y-websocket` — the WebSocket provider reimplements the wire protocol for control and bundle-size. The `y-protocols/awareness` dependency is used through the already-bundled `@pen/crdt-yjs`.

### `@pen/history`

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

---

## Key Decisions

1. **Custom WebSocket provider, not `y-websocket`.** Full control over reconnection, message framing, and awareness lifecycle. Wire-compatible with existing `y-websocket` servers.

2. **Jittered exponential backoff.** Prevents thundering herd when many clients reconnect simultaneously after server restart.

3. **Cursor and selection are separate awareness fields.** Cursor is the caret position. Selection is the anchor/head range. This allows rendering cursor labels even when there's no selection.

4. **`ClientIdentityMap` is the attribution bridge.** Maps Yjs numeric `clientID` to user metadata. Populated from awareness states. Used by both collab presence and history attribution.

5. **Snapshot = `Y.encodeStateVector` + `Y.encodeStateAsUpdate`.** Binary format, not a full document copy. Compact and fast to create/restore.

6. **Auto-save before restore.** Restoring a snapshot always creates a "Pre-restore" snapshot first. No data loss.

7. **Per-character attribution uses `CRDTAdapter.getAttributionRanges`.** Delegates to the adapter to extract authorship ranges without touching Yjs internals. Adjacent same-author characters are merged into ranges.

8. **History is independent of collab.** `@pen/history` reads CRDT metadata directly. It works in single-user mode too. Identity resolution is optional via a `resolveUser` callback.

9. **Decorations are the rendering contract.** Remote cursors, selections, and AI presence are all expressed as `InlineDecoration` / `BlockDecoration` — the same system that track changes uses. No special rendering path.

10. **CRDT corruption during collaboration is detected and recoverable.** The `DocumentHealthMonitor` (Wave 1, "CRDT Integrity" section) runs validation after every remote merge. If a corrupt update from a buggy peer introduces invalid state, the corruption event propagates through `crdt:corruption`, and the collaboration layer can trigger a re-sync or snapshot-based recovery. The WebSocket provider's `handleMessage` wraps `Y.applyUpdate` in error handling (see Wave 1, `applyUpdate` Error Handling) to drop malformed updates without crashing the session.

11. **Conflict resolution for collaborative edits is specified in Wave 1.** The "Conflict Resolution Semantics" section in Wave 1 defines the editor-level behavior for concurrent text edits, block type conversions, delete-while-editing, and block reorder conflicts. The collaboration layer surfaces these conflicts through awareness (remote cursor visibility) and decorations (remote selection highlighting), but does not attempt to prevent them — CRDT convergence handles the data layer, and normalization handles the semantic layer.

---

## Acceptance Criteria

1. WebSocket sync provider connects to `y-websocket`-compatible server and syncs documents.
2. Disconnect triggers exponential backoff reconnection. Reconnection succeeds and resumes sync.
3. Local selection changes are published to awareness. Remote peers see cursor position and selection range.
4. Remote cursors render as `InlineDecoration` with user color and name.
5. Remote selections render as highlighted ranges with user color.
6. Cross-block selections render correctly across multiple blocks.
7. AI presence decorations show which block an AI agent is working on and its status.
8. `Pen.Collab.PresenceList` shows all connected peers with avatars.
9. `Pen.Collab.ConnectionStatus` reflects connection state changes.
10. Color assignment is deterministic — same userId always produces the same color.
11. Manual snapshot creation captures document state as binary data.
12. Snapshot restoration loads a previous document state. Pre-restore auto-save is created.
13. Auto-snapshot fires on: session start, time interval (5 min), operation threshold (100 ops).
14. AI extension can trigger pre-generation snapshots via `scheduler.triggerAISnapshot()`.
15. `Pen.History.Timeline` lists snapshots sorted by creation time (newest first).
16. `Pen.History.SnapshotDiff` renders block-level diffs between two snapshots.
17. Per-character attribution uses `CRDTAdapter.getAttributionRanges` and returns `clientId` per character range.
18. `Pen.History.BlameGutter` renders author attribution alongside block content.
19. `ClientIdentityMap` resolves `clientId` to user metadata from awareness states.
20. History extension works without the collab extension (single-user mode with local snapshots).
21. All primitives support `asChild`, forward refs, render no styles, and expose `data-*` attributes.
22. Sync messages include `protocolVersion`; mismatched higher versions produce deterministic `UNSUPPORTED_PROTOCOL` diagnostics.
23. Unknown message types are ignored without disconnecting healthy peers.
24. Malformed sync payloads are dropped and surfaced via diagnostics without crashing the editor.
25. A malformed remote CRDT update received via WebSocket does not crash the editor. It emits a `crdt:diagnostic` event and the sync session continues.
26. After a remote merge that introduces an orphan block (in `blocks` but not `blockOrder`), the `DocumentHealthMonitor` detects and reports the inconsistency.
