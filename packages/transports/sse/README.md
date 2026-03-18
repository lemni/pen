# `@pen/transport-sse`

Server-Sent Events transport for Pen.

## Install

```bash
pnpm add @pen/core @pen/transport-sse
```

## What It Provides

- `sseTransport(...)` for client-side SSE streaming
- `createSSEHandler(...)` for a server-side request handler
- shared transport types such as `SSEClientOptions` and `SSEServerOptions`

## Server Example

```ts
import { createSSEHandler } from "@pen/transport-sse";

const handler = createSSEHandler({
  toolRuntime,
  onError(error) {
    console.error(error);
  },
});
```

## Client Example

```ts
import { sseTransport } from "@pen/transport-sse";

const transport = sseTransport({
  url: "https://example.com/api/stream",
  pingTimeout: 30_000,
});
```

## Integration Notes

- This package handles streaming transport concerns, not editor authority or product UI.
- The host application still owns endpoint routing, auth, headers, retry policy, and server deployment.
- `createSSEHandler()` can execute Pen tool-runtime requests and stream `PenStreamPart` events back to the client.
