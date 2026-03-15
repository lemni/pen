<img width="100%" height="auto" alt="cover@2x" src="https://github.com/user-attachments/assets/20356e3d-4a7c-4e65-b687-e680db017547" />

<h3 align="center">
  Headless, extension-first editor<br/> engine for human-AI collaboration
</h3>

<p align="center">
  <a href="https://www.npmjs.com/package/@pen/core"><img src="https://img.shields.io/npm/v/@pen/core?color=0368FF&label=version" alt="npm version" /></a>
  <img src="https://img.shields.io/github/stars/niceperson/pen?style=flat&color=8D30FF" alt="GitHub stars" />
  <img src="https://img.shields.io/badge/license-Pen-FF2B6E" alt="license" />
</p>


```bash
npm install @pen/core @pen/preset-default @pen/react
```

## Table of Contents

1. [Why Pen?](#why-pen)
2. [Quick Start](#quick-start)
3. [Architecture](#architecture)
4. [Packages](#packages)
5. [Development](#development)
6. [Milestones](#milestones)
7. [Contributing](#contributing)
8. [Authors](#authors)
9. [License](#license)

## Why Pen?

- **Headless:** Behavior and state separated from rendering.
- **AI-native:** Document model, operation format, and extension architecture designed around how LLMs generate and how humans collaborate with them.
- **Extension-first:** Core is tiny. Blocks, formatting, AI, execution, undo, import/export, and document tools are all packaged as extensions.
- **Shared field editor:** One content-editing engine powers blocks, table cells, database surfaces, and other structured text contexts.
- **Schema-driven:** Block types, layout rules, and content as declarative schemas. Render with React today, while keeping the core headless enough for future framework and server-rendered adapters.
- **CRDT-first:** Documents stored and transmitted as binary CRDT state. Yjs default, with future portability to Loro or Automerge.
- **Model-agnostic:** A minimal `ModelAdapter` interface works with any LLM client, including the Vercel AI SDK and its 25+ providers. Native tool execution is package-first through `@pen/ai-tools`, and agent-facing skill artifacts can be surfaced through `@pen/ai-skills`.
- **Explicit defaults:** `defaultPreset()` gives you the standard Pen runtime stack, while `createEditor()` still supports low-level setups when you need to compose your own defaults.

```
ProseMirror / Lexical       Pen                      TipTap / Plate
(raw engine)           (headless toolkit)            (opinionated toolkit)
◄────────────────────────────┼──────────────────────────────────►
no UI primitives        unstyled behavioral           styled components
build everything        primitives + AI-native        some assembly required
                        CRDT-first, schema-driven     framework-coupled
                        you bring the design          design decisions made
```

## Quick Start

The minimum viable Pen editor:

```tsx
import { createEditor } from '@pen/core'
import { defaultPreset } from '@pen/preset-default'
import { PenEditor } from '@pen/react'

const editor = createEditor({
  preset: defaultPreset(),
})

function App() {
  return <PenEditor editor={editor} />
}
```

Add a formatting toolbar:

```tsx
import { createEditor } from '@pen/core'
import { defaultPreset } from '@pen/preset-default'
import { Pen } from '@pen/react'

const editor = createEditor({
  preset: defaultPreset(),
})

function App() {
  return (
    <Pen.Editor.Root editor={editor}>
      <Pen.Toolbar.Root>
        <Pen.Toolbar.Group>
          <Pen.Toolbar.Toggle format="bold">B</Pen.Toolbar.Toggle>
          <Pen.Toolbar.Toggle format="italic">I</Pen.Toolbar.Toggle>
          <Pen.Toolbar.Toggle format="underline">U</Pen.Toolbar.Toggle>
        </Pen.Toolbar.Group>
        <Pen.Toolbar.Separator />
        <Pen.Toolbar.Select
          format="blockType"
          options={[
            { value: 'paragraph', label: 'Paragraph' },
            { value: 'heading', label: 'Heading' },
          ]}
        />
      </Pen.Toolbar.Root>
      <Pen.Editor.Content />
    </Pen.Editor.Root>
  )
}
```

Selection behavior defaults:

- `Cmd/Ctrl+A` follows the interaction model.
- In the default content-first editor surface, `Cmd/Ctrl+A` selects the whole document.
- In block-first mode, the first `Cmd/Ctrl+A` selects the current block and the second selects the whole document.
- When table or database cell selection is active, `Cmd/Ctrl+A` stays scoped to the current grid block.

```tsx
import { createEditor } from '@pen/core'
import { defaultPreset } from '@pen/preset-default'
import { PenEditor } from '@pen/react'

const editor = createEditor({
  preset: defaultPreset(),
})

function App() {
  return (
    <PenEditor
      editor={editor}
      interactionModel="block-first"
    />
  )
}
```

Constrain marquee block selection to a custom surface:

```tsx
import { createEditor } from '@pen/core'
import { defaultPreset } from '@pen/preset-default'
import { Pen } from '@pen/react'
import { useRef } from 'react'

const editor = createEditor({
  preset: defaultPreset(),
})

function App() {
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  const getSelectionRegion = () => {
    return surfaceRef.current?.getBoundingClientRect() ?? null
  }

  return (
    <div ref={surfaceRef}>
      <Pen.Editor.Root editor={editor}>
        <Pen.Editor.Content />
        <Pen.Editor.RegionSelector getRegionRect={getSelectionRegion} />
        <Pen.Editor.SelectionRect />
      </Pen.Editor.Root>
    </div>
  )
}
```

Use `getRegionRect` when the selection marquee should stay inside a larger app surface, such as a page body beneath a topbar, instead of defaulting to the editor content column.

Enable markdown-style autoformat as an extension:

```tsx
import { createEditor } from '@pen/core'
import { defaultPreset } from '@pen/preset-default'
import { inputRulesExtension } from '@pen/input-rules'

const editor = createEditor({
  preset: defaultPreset(),
  extensions: [inputRulesExtension()],
})
```

Leave the extension out to keep markdown autoformat disabled:

```tsx
const editor = createEditor({
  preset: defaultPreset(),
})
```

Add AI streaming with any model provider:

```tsx
import { createEditor } from '@pen/core'
import type { ModelAdapter, ModelMessage } from '@pen/types'
import { defaultPreset } from '@pen/preset-default'
import { aiExtension } from '@pen/ai'
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import { Pen } from '@pen/react'

function flattenMessageContent(content: ModelMessage['content']): string {
  if (typeof content === 'string') {
    return content
  }

  return content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('\n')
}

const model: ModelAdapter = {
  async *stream(options) {
    const result = streamText({
      model: anthropic('your-model-id'),
      messages: options.messages.map((message) => ({
        role: message.role,
        content: flattenMessageContent(message.content),
      })),
      abortSignal: options.signal,
    })

    for await (const delta of result.textStream) {
      yield { type: 'text-delta', delta }
    }

    yield { type: 'done' }
  },
}

const editor = createEditor({
  preset: defaultPreset(),
  extensions: [
    aiExtension({
      model,
      contentFormat: {
        blockGeneration: 'markdown',
        selectionRewrite: 'text',
      },
    }),
  ],
})

function App() {
  return (
    <Pen.Editor.Root editor={editor}>
      <Pen.AI.Root editor={editor}>
        <Pen.Editor.Content />
      </Pen.AI.Root>
    </Pen.Editor.Root>
  )
}
```

`Pen.AI.Root` consumes the AI controller installed by `aiExtension(...)`. Add the React AI primitives you need around that context.

Style inline suggestion keep/undo controls your way:

```tsx
import { createEditor } from '@pen/core'
import { defaultPreset } from '@pen/preset-default'
import { Pen } from '@pen/react'

const editor = createEditor({
  preset: defaultPreset(),
})

function App() {
  return (
    <Pen.Editor.Root editor={editor}>
      <Pen.AI.Root editor={editor}>
        <Pen.Editor.Content />

        <Pen.AI.InlineSuggestionControls>
          <Pen.AI.InlineSuggestionFloatingSurface>
            <div data-pen-ai-inline-suggestion-nav="">
              <Pen.AI.InlineSuggestionPrevious />
              <Pen.AI.InlineSuggestionCount />
              <Pen.AI.InlineSuggestionNext />
            </div>
            <Pen.AI.InlineSuggestionReject>Undo</Pen.AI.InlineSuggestionReject>
            <Pen.AI.InlineSuggestionAccept>Keep</Pen.AI.InlineSuggestionAccept>
          </Pen.AI.InlineSuggestionFloatingSurface>
        </Pen.AI.InlineSuggestionControls>
      </Pen.AI.Root>
    </Pen.Editor.Root>
  )
}
```

`Pen.AI.InlineSuggestionControls` is the headless state root for persistent inline suggestions. Use the built-in floating surface, or replace it with your own toolbar layout:

```tsx
<Pen.AI.InlineSuggestionControls asChild>
  <div className="my-review-toolbar">
    <Pen.AI.InlineSuggestionCount />
    <Pen.AI.InlineSuggestionReject />
    <Pen.AI.InlineSuggestionAccept />
  </div>
</Pen.AI.InlineSuggestionControls>
```

Progressive capability -- same engine, different surface:

```tsx
import { createEditor } from '@pen/core'
import { defaultPreset } from '@pen/preset-default'
import { defaultSchema } from '@pen/schema-default'

// M0: custom schema plus the standard Pen runtime preset
const editor = createEditor({
  preset: defaultPreset(),
  schema: defaultSchema.extend([myCustomBlock]),
})

// Layer on more extensions without changing the editor shell:
// const editor = createEditor({
//   preset: defaultPreset(),
//   schema: defaultSchema.extend([myCustomBlock]),
//   extensions: [
//     myCustomExtension(),
//   ],
// })
```

## Tool API

Pen's agent/tool surface is package-first. The standard `defaultPreset()` includes `@pen/document-ops`, `@pen/ai-tools` gives you the canonical agent-facing tool runtime, and `@pen/ai-skills` packages those tools into agent skill artifacts.

```ts
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { getAIToolRuntime } from "@pen/ai-tools";
import { directTransport } from "@pen/transport-direct";

const editor = createEditor({
  preset: defaultPreset(),
});
const toolRuntime = getAIToolRuntime(editor);

if (!toolRuntime) {
  throw new Error("AI tools are unavailable.");
}

const transport = directTransport({ toolRuntime });
```

Recommended package entrypoints:

- `@pen/types`: contracts such as `ToolRegistry`, `ToolRuntime`, `ToolDefinition`, `ToolContext`, and `PenTransport`
- `@pen/core`: runtime entrypoints such as `createEditor()` and `createDocumentSession()`
- `@pen/preset-default`: the standard document tools, streaming, undo, and shortcut stack for most apps
- `@pen/document-ops`: document semantics and advanced low-level tool internals
- `@pen/ai-tools`: canonical agent/tool package, tool descriptors, execution helpers, and tool runtime accessors
- `@pen/ai-skills`: agent-facing skill registry and generated skill artifacts
- `@pen/transport-direct`: in-process tool execution
- `@pen/transport-sse`: Pen-native remote streaming

When you need low-level mutation helpers outside the built-in AI/runtime flows, `ToolContextImpl` and `ToolRuntimeImpl` remain available from `@pen/document-ops` as advanced APIs. When you need to surface those tools to agents, build skills from `@pen/ai-skills` rather than introducing a second execution protocol.

The playground backend follows the same shape: it exposes native tool routes under `/api/tools` and skill artifacts under `/api/skills`.

## Architecture

Three layers: **Schema** (data), **Headless** (behavior), **Rendering** (UI). Each independent and swappable.

```
┌───────────────────────────────────────────────────────────┐
│ Consumer Application                                      │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Rendering Layer                                      │ │
│  │ (unstyled React primitives today; more adapters later)│ │
│  └────────────────────────┬─────────────────────────────┘ │
│                           │ consumes                      │
│  ┌────────────────────────┴─────────────────────────────┐ │
│  │ Headless Layer                                       │ │
│  │ Unstyled behavioral primitives                       │ │
│  │                                                      │ │
│  │  ┌────────┐ ┌─────────┐ ┌──────────┐ ┌────────────┐  │ │
│  │  │ Editor │ │ Toolbar │ │ SlashMenu│ │ AI         │  │ │
│  │  │ .Root  │ │ .Root   │ │ .Root    │ │ .Root      │  │ │
│  │  │ .Block │ │ .Group  │ │ .Input   │ │ .Trigger   │  │ │
│  │  │ .Inline│ │ .Button │ │ .List    │ │ .Panel     │  │ │
│  │  │ .Layout│ │ .Toggle │ │ .Item    │ │ .Stream    │  │ │
│  │  │ .App   │ │         │ │          │ │            │  │ │
│  │  └────────┘ └─────────┘ └──────────┘ └────────────┘  │ │
│  │                                                      │ │
│  │  ┌──────────────────────────────────────────────┐    │ │
│  │  │ Field Editor (shared content editor)         │    │ │
│  │  ├──────────────────────────────────────────────┤    │ │
│  │  │ Extension Host (tx hooks, decorations, state)│    │ │
│  │  ├──────────────────────────────────────────────┤    │ │
│  │  │ Selection Manager (cross-block aware)        │    │ │
│  │  ├──────────────────────────────────────────────┤    │ │
│  │  │ Decoration Engine (non-mutating overlays)    │    │ │
│  │  └──────────────────────────────────────────────┘    │ │
│  │                                                      │ │
│  └────────────────────────┬─────────────────────────────┘ │
│                           │ reads/writes                  │
│  ┌────────────────────────┴─────────────────────────────┐ │
│  │ Schema Layer                                         │ │
│  │ CRDTDocument ← block schemas, layout rules,          │ │
│  │                 content model, app state             │ │
│  │                                                      │ │
│  │  ┌──────────────────────────────────────────────┐    │ │
│  │  │ CRDTAdapter interface                        │    │ │
│  │  │ ├─ YjsAdapter (default)                      │    │ │
│  │  │ ├─ LoroAdapter (future)                      │    │ │
│  │  │ └─ AutomergeAdapter (future)                 │    │ │
│  │  └──────────────────────────────────────────────┘    │ │
│  │                                                      │ │
│  └──────────────────────────────────────────────────────┘ │
└───────────────────────────────────────────────────────────┘
```

### Authoring vs Serialization

Pen intentionally separates authoring policy from document serialization.

- Authoring surfaces are profile-aware. Slash menus, default toolbar block pickers, tool/AI writes, and paste/import normalization respect the active `documentProfile` and may hide or reject certain block types in flow documents.
- Serialization surfaces are preservation-oriented. Exporters serialize the document graph that already exists, including seeded structured blocks, nested content, and hidden/system blocks, instead of silently dropping them because they are not default insertion targets.

In practice:

- Use `shouldShowBlockInDefaultMenus()` and `shouldExposeBlockInTooling()` when deciding what users or tools may insert.
- Use import normalization and `ImportResult` when shaping incoming content to the active authoring surface.
- Do not use authoring visibility helpers to decide what an exporter should preserve.

## Packages

### Core

| Package | Description |
|---|---|
| `@pen/core` | Runtime host: `createEditor()`, document sessions, schema engine, field editor host, selection, decorations, undo |
| `@pen/types` | Zero-dependency contracts: `ToolRegistry`, `ToolRuntime`, `ToolDefinition`, `ToolContext`, `PenTransport`, editor types |
| `@pen/crdt-yjs` | Yjs CRDT adapter (default) |
| `@pen/schema-default` | Default block schemas (paragraph, heading, list, code, image, table, divider, callout, toggle, blockquote) |

### Presets

| Package | Description |
|---|---|
| `@pen/preset-default` | Standard Pen runtime preset: document tools, delta stream, undo, and rich-text shortcuts |

### Rendering

| Package | Description |
|---|---|
| `@pen/react` | React primitives, hooks, field editor implementation |

### Extensions

| Package | Description |
|---|---|
| `@pen/document-ops` | Default document tool suite, `getDocumentToolRuntime()`, advanced `ToolContextImpl`/`ToolRuntimeImpl` APIs |
| `@pen/ai` | Core AI extension: streaming, structured previews, suggestions, track changes, and AI session orchestration |
| `@pen/ai-autocomplete` | Inline autocomplete extension and controller |
| `@pen/ai-tools` | Canonical public AI tool surface for agents, transports, and direct editor-attached tool execution |
| `@pen/ai-skills` | Agent skill registry and generated skill artifacts built on top of `@pen/ai-tools` |
| `@pen/database` | Database block schemas, controller, renderer, and cell editors |
| `@pen/delta-stream` | Streaming protocol, processing pipeline |
| `@pen/input-rules` | Opt-in markdown autoformat extension |
| `@pen/undo` | Undo groups, origin tagging, field editor integration |
| `@pen/import-html` | HTML importer with sanitization |
| `@pen/import-markdown` | Markdown importer |

### Transports

| Package | Description |
|---|---|
| `@pen/transport-sse` | Server-Sent Events transport |
| `@pen/transport-direct` | In-process transport |

### Tooling

| Package | Description |
|---|---|
| `@pen/test` | Headless testing utilities |
| `@pen/bench` | Performance benchmarks |
| `@pen/assets-memory` | In-memory asset provider (test/demo) |

## Development

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run all tests
pnpm test

# Typecheck all packages
pnpm typecheck
```

### Golden Path (New Contributor)

The fastest way to a working editor:

1. **Clone and install.** `git clone <repo> && cd pen && pnpm install`
2. **Build.** `pnpm build` — all packages build with zero errors.
3. **Run tests.** `pnpm test` — headless test suite passes (no browser required).
4. **Typecheck.** `pnpm typecheck` — monorepo-wide type safety.
5. **Start from a small app shell.** Create a React + Vite app, install `@pen/core`, `@pen/preset-default`, and `@pen/react`, then drop in the Quick Start example above.
6. **Explore the spec.** Start with `spec/v01.md` for architecture and design principles, then dive into wave specs (`spec/wave00FoundationTypes.md` onward) for implementation details.

### Spec Navigation

| Document | What it covers |
|---|---|
| `spec/v01.md` | Full technical specification: architecture, types, schema, selection, extensions, streaming, milestones |
| `spec/wave00FoundationTypes.md` | `@pen/types` — type definitions, `prop` builder, `defineBlock`, `defineExtension` |
| `spec/wave01CrdtLayer.md` | `@pen/crdt-yjs` — Yjs adapter, CRDT events, conflict resolution |
| `spec/wave02SchemaEngine.md` | Schema engine, normalization, `BlockHandle` API, default schema, `@pen/test` |
| `spec/wave03EditorCore.md` | `createEditor()`, apply pipeline, extensions, undo, streaming |
| `spec/wave04TransportsImporters.md` | SSE/direct transports, markdown/HTML importers and exporters |
| `spec/wave05ReactRendering.md` | React primitives, field editor, hooks, toolbar, clipboard |
| `spec/wave06AiToolsBenchIntegration.md` | AI tools, benchmarks, M0 exit criteria |
| `spec/wave07AiTrackChanges.md` | AI extension, suggestions, track changes |
| `spec/wave08CollaborationHistory.md` | Multiplayer, presence, awareness, version history |
| `spec/wave09SearchInputRulesCli.md` | Search, input rules, `pen create` CLI |
| `spec/wave10Layout.md` | Layout containers, flex/grid blocks, responsive stacks |
| `spec/wave11AppsExecution.md` | Embedded apps, execution sandboxing, document branching |
| `spec/wave12ProductionEcosystem.md` | Auth, rate limiting, Vue/Svelte, Loro, documentation site |
| `spec/errataLedger.md` | Consolidated errata triage across all waves |

## Milestones

- **M0 -- Core Steel Thread.** Working editor with schema engine, field editor, AI streaming, undo, decorations, and React rendering.
- **M1 -- AI Primitives + Collaboration.** Track changes, version history, search, multiplayer, and app bootstrap tooling.
- **M2 -- Layout + Apps + Execution.** Structured layout, interactive apps, Docker sandboxing, document branching.
- **M3 -- Production + Ecosystem.** Auth, rate limiting, exporters, additional framework adapters, Loro adapter, documentation site.

For detailed milestone scope, exit criteria, and decision locks, see `spec/v01.md` Section 21.

## Contributing

Pen is in active development. Contribution guidelines are coming soon.

By contributing to Pen, you agree to the [Contributor License Agreement](CLA.md).

### Pre-build Governance

Before implementation starts on any wave, the following must be satisfied:

- **Errata lock.** All items in `spec/errataLedger.md` for that wave must be triaged (fixed in spec, implementation-required, or deferred).
- **Diagnostics contract.** All diagnostic emissions must use structured codes per `spec/v01.md` Section 22.
- **API stability.** Public API changes follow the stability policy in `spec/v01.md` Section 23.

## Authors

Pen is created by [Input](https://www.input.so/).

## License

The Pen SDK is provided under the [Pen license](LICENSE.md). You can use the SDK freely in development. Production use requires a license. Contact [input.so](https://www.input.so/) to learn more.

Copyright (c) 2025-present Input B.V.
