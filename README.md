<!-- markdownlint-disable MD033 MD041 -->
<img width="100%" height="auto" alt="logo_black@2x" src="" />

<h3 align="center">
  Headless, extension-first rich text<br/>editor engine for AI collaboration
</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@pen/core"><img src="https://img.shields.io/npm/v/@pen/core?color=0368FF&label=version" alt="npm version" /></a>
  <img src="https://img.shields.io/github/stars/niceperson/pen?style=flat&color=8D30FF" alt="GitHub stars" />
  <img src="https://img.shields.io/badge/license-Pen-FF2B6E" alt="license" />
</p>
<!-- markdownlint-enable MD033 MD041 -->

# Pen

Pen is a source-available SDK published as public npm packages. You can evaluate and develop with it freely, but production use requires a commercial license from Input.

```bash
pnpm add @pen/core @pen/preset-default @pen/react
```

## What Pen Is

Pen is a package-first editor toolkit built around a headless runtime, schema-driven document model, and explicit extension composition. The core editor owns document state, selection, normalization, and mutation authority, while renderer packages bind that runtime to React or Vue.

## Quick Start

The smallest recommended setup uses the core runtime, the default preset, and the React renderer.

```tsx
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { PenEditor } from "@pen/react";

const editor = createEditor({
  preset: defaultPreset(),
});

export function App() {
  return <PenEditor editor={editor} />;
}
```

`PenEditor` is the fastest path. If you want to own the shell, layout, and controls, use the compound primitives directly.

## Headless UI Examples

Pen keeps runtime state and document mutation in the editor. Your app can subscribe to that state and render any UI system around it.

### Editor Example

This example keeps Pen headless where it matters while still giving you a batteries-included editor surface in React.

```bash
pnpm add @pen/ai @pen/input-rules @pen/search @pen/shortcuts
```

```tsx
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { inputRulesExtension } from "@pen/input-rules";
import { searchExtension, getSearchController } from "@pen/search";
import { Pen } from "@pen/react";

const editor = createEditor({
  preset: defaultPreset(),
  extensions: [inputRulesExtension(), searchExtension()],
});

export function App() {
  return (
    <Pen.Editor.Root editor={editor}>
      <section className="editor-shell">
        <header className="editor-toolbar">
          <button
            type="button"
            onClick={() => getSearchController(editor)?.toggleOpen()}
          >
            Search
          </button>
        </header>

        <Pen.Search.Root editor={editor}>
          <Pen.Search.Input />
          <Pen.Search.Results />
          <Pen.Search.Previous>Previous</Pen.Search.Previous>
          <Pen.Search.Next>Next</Pen.Search.Next>
        </Pen.Search.Root>

        <Pen.Editor.Content />
      </section>
    </Pen.Editor.Root>
  );
}
```

You can stop at `PenEditor`, compose `Pen.*` primitives, or replace the UI entirely with your own controls.

### Bring Your Own Toolbar

`useToolbar(editor)` exposes formatting state, and `@pen/shortcuts` gives you reusable formatting commands. That lets you render your own toolbar shell without giving up Pen's selection-aware behavior.

```tsx
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { toggleInlineMark } from "@pen/shortcuts";
import { Pen, useToolbar } from "@pen/react";

const editor = createEditor({
  preset: defaultPreset(),
});

function FormattingToolbar() {
  const toolbar = useToolbar(editor);
  const currentBlockId =
    editor.selection?.type === "text" ? editor.selection.anchor.blockId : null;

  function handleHeading() {
    if (!currentBlockId) {
      return;
    }

    editor.apply(
      [{ type: "convert-block", blockId: currentBlockId, newType: "heading" }],
      { origin: "user" },
    );
  }

  return (
    <div className="toolbar">
      <button
        type="button"
        disabled={!toolbar.canBold}
        aria-pressed={Boolean(toolbar.activeMarks.bold)}
        onClick={() => toggleInlineMark(editor, "bold")}
      >
        Bold
      </button>
      <button
        type="button"
        disabled={!toolbar.canItalic}
        aria-pressed={Boolean(toolbar.activeMarks.italic)}
        onClick={() => toggleInlineMark(editor, "italic")}
      >
        Italic
      </button>
      <button type="button" disabled={!currentBlockId} onClick={handleHeading}>
        Heading
      </button>
      <span>Block: {toolbar.blockType ?? "paragraph"}</span>
    </div>
  );
}

export function App() {
  return (
    <Pen.Editor.Root editor={editor}>
      <FormattingToolbar />
      <Pen.Editor.Content />
    </Pen.Editor.Root>
  );
}
```

### Bring Your Own AI UI

`@pen/ai` owns sessions, generation state, and suggest-mode behavior. In React, you can wire that state into your own chat panel, action bar, or review surface.

```tsx
import { useState } from "react";
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { aiExtension } from "@pen/ai";
import { Pen, useAI, useAIActions, useAISessions } from "@pen/react";

const editor = createEditor({
  preset: defaultPreset(),
  extensions: [
    aiExtension({
      model: {
        async *stream() {
          yield {
            type: "text-delta" as const,
            delta: "Here is a clearer version of the selected text.",
          };
          yield { type: "done" as const };
        },
      },
    }),
  ],
});

function AIPanel() {
  const [prompt, setPrompt] = useState("Rewrite the selection to be clearer.");
  const ai = useAI(editor);
  const sessions = useAISessions(editor);
  const actions = useAIActions(editor);
  const latestSession = sessions[sessions.length - 1] ?? null;

  async function handleSubmit() {
    const session = actions.startSession({
      surface: "bottom-chat",
      target: "selection",
    });

    if (!session) {
      return;
    }

    await actions.runSessionPrompt(session.id, prompt, {
      target: "selection",
    });
  }

  return (
    <aside className="ai-panel">
      <textarea
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
      />
      <div className="ai-actions">
        <button
          type="button"
          disabled={prompt.length === 0 || ai.status !== "idle"}
          onClick={() => void handleSubmit()}
        >
          Ask AI
        </button>
        <button type="button" onClick={() => actions.openCommandMenu()}>
          Commands
        </button>
      </div>
      <p>Status: {ai.status}</p>
      <p>
        Latest session:{" "}
        {latestSession
          ? `${latestSession.status} with ${latestSession.turns.length} turn(s)`
          : "none"}
      </p>
    </aside>
  );
}

export function App() {
  return (
    <Pen.Editor.Root editor={editor}>
      <AIPanel />
      <Pen.Editor.Content />
    </Pen.Editor.Root>
  );
}
```

If you want less custom UI code, `@pen/react` also ships `Pen.Toolbar.*` and `Pen.AI.*` primitives on top of the same runtime.

## Recommended Packages

- `@pen/core`: create editors and access the headless runtime
- `@pen/types`: contracts and shared type-level helpers
- `@pen/schema-default`: default blocks and inline definitions
- `@pen/preset-default`: standard runtime composition for most adopters
- `@pen/react`: primary documented renderer surface
- `@pen/crdt-yjs`: Yjs adapter for collaborative setups

## Optional Capabilities

### Rendering

- `@pen/vue`: shipped Vue renderer proof built on the shared DOM engine
- `@pen/dom`: shared DOM field-editor engine and low-level DOM helpers

### Editing And Extensions

- `@pen/search`: document search and replacement primitives
- `@pen/input-rules`: opt-in markdown shortcut typing
- `@pen/undo`: undo and redo with origin tagging
- `@pen/shortcuts`: headless keyboard shortcut extension
- `@pen/history`: snapshot history and attribution primitives
- `@pen/database`: database block behaviors
- `@pen/document-ops`: document tool and generation-zone helpers

### AI

- `@pen/ai`: AI extension, suggest mode, and track changes
- `@pen/ai-autocomplete`: inline autocomplete
- `@pen/ai-tools`: canonical AI tool surface
- `@pen/ai-skills`: agent-facing skill artifacts

### Collaboration And Transport

- `@pen/multiplayer`: multiplayer presence and sync primitives
- `@pen/delta-stream`: streaming protocol and processing pipeline
- `@pen/transport-direct`: in-process transport
- `@pen/transport-sse`: Server-Sent Events transport

### Import And Export

- `@pen/import-markdown` and `@pen/import-html`
- `@pen/export-markdown`, `@pen/export-html`, `@pen/export-json`, and `@pen/export-xml`

## Architecture

Pen keeps one block-native document model and one canonical mutation path.

- `editor.apply(...)` is the runtime authority boundary for document writes.
- `DocumentOp[]` is the mutation currency shared across runtime features.
- Extensions compose optional behavior without replacing the editor authority boundary.
- Renderer packages stay separate from the core runtime.
- JSON is the canonical machine-readable format. XML exists for interoperability.

For the full current-state package and architecture specs, see [spec/README.md](spec/README.md).

## Repository Resources

- `packages/docs`: repository docs app for the current public Pen surface
- `.github/workflows/docs.yml`: GitHub Pages deployment for the docs app after Pages is enabled for the repository
- `playground`: integration sandbox for trying renderer, AI, and collaboration flows
- `playground/src/utils/playgroundCollaboration.ts`: concrete `y-websocket` wiring used by the playground

## Development

```bash
pnpm install
pnpm lint
pnpm build
pnpm test
pnpm typecheck
```

## Community

- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Security Policy](SECURITY.md)
- [Support](SUPPORT.md)

## Authors

Pen is created by [Input](https://www.input.so/).

## License

The Pen SDK is provided under the [Pen license](LICENSE.md). You can use the SDK freely in development. Production use requires a license. Contact [input.so](https://www.input.so/) to learn more.

Copyright (c) 2026-present Input B.V.
