# @pen/core

Headless editor runtime for Pen.

This package is published publicly, but the Pen SDK is source-available rather than OSI open source. Production use requires a license from Input.

## Install

```bash
pnpm add @pen/core
```

## What It Provides

- `createEditor(...)` to create editor instances
- `createHeadlessEditor(...)` for server-side, worker, and test workflows that need editor semantics without a renderer
- document state, selection, normalization, and mutation orchestration
- the canonical `editor.apply(...)` document mutation boundary

## Headless Usage

```ts
import { createHeadlessEditor } from "@pen/core";
import { yjsAdapter, wrapYjsDocument } from "@pen/crdt-yjs";

const adapter = yjsAdapter();
const editor = createHeadlessEditor({
  crdt: adapter,
  document: wrapYjsDocument(adapter, ydoc),
});
```

Use this shape for migrations, AI workers, export workers, and tests that should run through Pen's mutation pipeline without mounting a UI.

## Typical Pairing

Most apps use `@pen/core` with:

- `@pen/preset-default`
- `@pen/react` or `@pen/vue`

See the repository root README for the broader package map and licensing details.
