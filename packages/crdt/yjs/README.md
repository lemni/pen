# `@pen/crdt-yjs`

Yjs integration for Pen.

This package provides:

- the Pen Yjs CRDT adapter via `yjsAdapter()`
- Yjs awareness helpers
- a thin provider wrapper for multiplayer sessions
- Yjs state-vector helpers for sync/workflow barriers
- generic Yjs text and array field adapters for host-owned CRDT fields
- generic extension-root helpers for app-owned Yjs maps under `apps`

It does **not** implement WebSocket transport or a custom Yjs sync provider.

## State barriers

```ts
import {
  encodeYjsStateVectorBase64,
  isYjsStateVectorBase64Satisfied,
} from "@pen/crdt-yjs";

const required = encodeYjsStateVectorBase64(ydoc);
const ready = isYjsStateVectorBase64Satisfied(currentStateVector, required);
```

Use state-vector helpers when a host workflow needs to wait until a synced document includes a known local edit.

## Field adapters

```ts
import {
  createYArrayFieldAdapter,
  createYTextFieldAdapter,
} from "@pen/crdt-yjs";

const title = createYTextFieldAdapter({
  doc: ydoc,
  root: ydoc.getMap("app"),
  key: "title",
  normalize: (value) => value.trim(),
});

const tags = createYArrayFieldAdapter({
  doc: ydoc,
  root: ydoc.getMap("app"),
  key: "tags",
  getId: (tag) => tag.id,
});
```

Adapters are storage helpers only. Product validation, labels, contacts, auth, and delivery semantics belong in the host app.

## Extension roots

```ts
import { ensureExtensionRoot, readExtensionRoot } from "@pen/crdt-yjs";

const root = ensureExtensionRoot({
  doc: ydoc,
  namespace: "com.example.workflow",
  version: 1,
  shape: {
    title: "text",
    requests: "array",
  },
});

const existing = readExtensionRoot({
  doc: ydoc,
  namespace: "com.example.workflow",
});
```

Extension roots give host apps a predictable place for CRDT-backed data that travels with the Pen document while staying outside Pen's core block model.

## Collaboration boundary

When using multiplayer with Yjs, Pen expects the application to choose the provider and hand Pen a `MultiplayerSession`.

`@pen/crdt-yjs` exposes the minimal helpers needed for that:

```ts
import {
  createYjsProviderSession,
  getYjsAwareness,
  getYjsDoc,
} from "@pen/crdt-yjs";
```

## Canonical `y-websocket` setup

This is the recommended setup when using [`y-websocket`](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket):

```ts
import { createEditor } from "@pen/core";
import {
  createYjsProviderSession,
  getYjsAwareness,
  getYjsDoc,
} from "@pen/crdt-yjs";
import { multiplayerExtension } from "@pen/multiplayer";
import { WebsocketProvider } from "y-websocket";

const editor = createEditor({
  extensions: [
    multiplayerExtension({
      user: { id: "u1", name: "Ada" },
      sessionFactory: ({ editor, awareness }) => {
        const provider = new WebsocketProvider(
          "ws://localhost:1234",
          "room-a",
          getYjsDoc(editor),
          {
            awareness: getYjsAwareness(awareness),
            connect: false,
          },
        );

        return createYjsProviderSession({
          connect: () => provider.connect(),
          disconnect: () => provider.disconnect(),
          destroy: () => provider.destroy(),
          getStatus: () => {
            if (provider.wsconnected) {
              return "connected";
            }

            if (provider.wsconnecting) {
              return "connecting";
            }

            return "disconnected";
          },
          getIsSynced: () => provider.synced,
          onStatusChange: (listener) => {
            const handleStatus = (event: {
              status: "disconnected" | "connecting" | "connected";
            }) => {
              listener(event.status);
            };

            provider.on("status", handleStatus);
            return () => {
              provider.off("status", handleStatus);
            };
          },
          onSync: (listener) => {
            provider.on("sync", listener);
            return () => {
              provider.off("sync", listener);
            };
          },
        });
      },
    }),
  ],
});
```

For a concrete repository reference, see
`playground/src/utils/playgroundCollaboration.ts`, which includes a reusable
`createYWebsocketSessionFactory()` helper for the playground&apos;s `y-websocket`
setup.

## Why `getYjsAwareness()` exists

Pen exposes a generic awareness interface through `@pen/types`, but Yjs providers such as `y-websocket` expect the underlying native Yjs `Awareness` instance.

Use:

- `getYjsDoc(editor)` to access the raw `Y.Doc`
- `getYjsAwareness(awareness)` to access the raw Yjs awareness object

## Provider adapter notes

`createYjsProviderSession()` works best when the provider adapter supplies:

- `onStatusChange()`
- `onSync()` when the provider distinguishes connected from fully synced
- `getStatus()` and `getIsSynced()` when the provider may already be active before Pen wraps it

If `onSync()` is omitted, a connected provider is treated as fully connected rather than `syncing`.
