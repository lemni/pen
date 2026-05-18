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
- `createDeterministicYDocFixture()` for stable Yjs updates and snapshots
- `runCRDTStateVectorContract()`, `runHeadlessEditorContract()`, and `runExportContract()` for opt-in package/app contracts
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

## Deterministic Fixtures

```ts
import {
  createDeterministicYDocFixture,
  runCRDTStateVectorContract,
} from "@pen/test";

const fixture = createDeterministicYDocFixture({
  blocks: [{ id: "p1", type: "paragraph", content: "Stable text" }],
});

expect(fixture.updateBase64).toMatchSnapshot();
runCRDTStateVectorContract({ createFixture: () => fixture });
```

## Integration Notes

- The test harness defaults to Pen's shipped schema and a Yjs-backed document.
- Override `schema`, `doc`, or other editor options when a test needs a custom runtime setup.
- Fixture helpers use generic Pen document roots and avoid product-specific fixture data.
- Contract helpers throw ordinary errors and do not require a specific test runner.
- These utilities are intended for package and app tests, not production editor bootstrapping.
