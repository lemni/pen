# `@pen/multiplayer`

Headless collaboration primitives for Pen.

This package owns editor-facing multiplayer behavior:

- local awareness publishing
- peer derivation
- remote cursor and selection state
- controller state
- multiplayer decorations

It does **not** own transport, reconnect, auth, or Yjs wire protocol behavior.

## Design

`@pen/multiplayer` is built around a small session interface from `@pen/types`:

```ts
export interface MultiplayerSession {
  readonly connectionState: ConnectionState;
  connect(): void;
  disconnect(): void;
  destroy(): void;
  onStateChange(listener: (state: ConnectionState) => void): Unsubscribe;
}
```

The extension accepts either a ready-made session or a `sessionFactory`:

```ts
import { multiplayerExtension } from "@pen/multiplayer";

multiplayerExtension({
  user: { id: "u1", name: "Ada" },
  session,
});
```

```ts
import { multiplayerExtension } from "@pen/multiplayer";

multiplayerExtension({
  user: { id: "u1", name: "Ada" },
  sessionFactory: ({ editor, awareness }) => {
    return session;
  },
});
```

## Recommended setup

If you are using Yjs, prefer:

- `@pen/multiplayer` for the multiplayer extension and controller state
- `@pen/crdt-yjs` for Yjs integration helpers
- an external provider such as [`y-websocket`](https://docs.yjs.dev/ecosystem/connection-provider/y-websocket) for transport

That keeps Pen transport-agnostic and lets the application choose its own provider model.

## Example

See `@pen/crdt-yjs` for the canonical `y-websocket` integration example using:

- `getYjsDoc()`
- `getYjsAwareness()`
- `createYjsProviderSession()`

For a concrete repository reference, see the playground collaboration wiring in
`playground/src/utils/playgroundCollaboration.ts`.
