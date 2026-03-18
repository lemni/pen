# `@pen/test`

Headless testing utilities for Pen.

## Install

```bash
pnpm add -D @pen/test
```

## What It Provides

- `createTestEditor()` for a Yjs-backed editor harness with the default schema
- `assertDocEquals()` for document-shape assertions
- `createTestCollaboration()` for two-editor sync tests
- `simulateTyping()` and `simulateKeypress()` helpers for editor interactions

## Minimal Setup

```ts
import { assertDocEquals, createTestEditor } from "@pen/test";

const editor = createTestEditor({
  blocks: [{ type: "paragraph", content: "Hello" }],
});

editor.simulateTyping(" world");

assertDocEquals(editor, [{ type: "paragraph", content: "Hello world" }]);
```

## Collaboration Harness

```ts
import { assertDocEquals, createTestCollaboration } from "@pen/test";

const collab = createTestCollaboration({
  blocks: [{ type: "paragraph", content: "Shared" }],
});

collab.editorA.simulateTyping(" doc");
collab.sync();

assertDocEquals(collab.editorA, collab.editorB);
```

## Integration Notes

- The test harness defaults to Pen's shipped schema and a Yjs-backed document.
- Override `schema`, `doc`, or other editor options when a test needs a custom runtime setup.
- These utilities are intended for package and app tests, not production editor bootstrapping.
