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
npm install @pen/core @pen/react
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
- **Extension-first:** Core is tiny. Everything -- blocks, formatting, AI, multiplayer, execution, apps -- is an extension.
- **Schema-driven:** Block types, layout rules, and content as declarative schemas. Compile to React, Vue, Svelte, HTML, or SSR without changing the definition.
- **CRDT-first:** Documents stored and transmitted as binary CRDT state. Yjs default, with future portability to Loro or Automerge.
- **Model-agnostic:** A minimal `ModelAdapter` interface works with any LLM client, including the Vercel AI SDK and its 25+ providers.
- **Zero-config to start:** createEditor() with zero args gives you a working editor.

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
import { PenEditor } from '@pen/react'

const editor = createEditor()

function App() {
  return <PenEditor editor={editor} />
}
```

Add a formatting toolbar:

```tsx
import { createEditor } from '@pen/core'
import * as Pen from '@pen/react'

const editor = createEditor()

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
        <Pen.Toolbar.Select format="blockType" options={['paragraph', 'heading']} />
      </Pen.Toolbar.Root>
      <Pen.Editor.Content />
    </Pen.Editor.Root>
  )
}
```

Add AI streaming with any model provider:

```tsx
import { createEditor } from '@pen/core'
import { streamText } from 'ai'
import { anthropic } from '@ai-sdk/anthropic'
import * as Pen from '@pen/react'

const editor = createEditor()

const modelAdapter: Pen.ModelAdapter = {
  stream: (options) => streamText({
    model: anthropic('claude-sonnet-4-6'),
    messages: options.messages,
    tools: Pen.penToolSchemas(options.tools),
    abortSignal: options.signal,
  }),
}

function App() {
  return (
    <Pen.Editor.Root editor={editor}>
      <Pen.Toolbar.Root>
        <Pen.Toolbar.Group>
          <Pen.Toolbar.Toggle format="bold">B</Pen.Toolbar.Toggle>
          <Pen.Toolbar.Toggle format="italic">I</Pen.Toolbar.Toggle>
        </Pen.Toolbar.Group>
      </Pen.Toolbar.Root>
      <Pen.Editor.Content />
      <Pen.AI.Root model={modelAdapter}>
        <Pen.AI.Trigger>Ask AI</Pen.AI.Trigger>
        <Pen.AI.CommandMenu>
          <Pen.AI.CommandInput placeholder="Ask AI to write, edit, or explain..." />
          <Pen.AI.CommandList>
            <Pen.AI.CommandItem command="continue">Continue writing</Pen.AI.CommandItem>
            <Pen.AI.CommandItem command="summarize">Summarize</Pen.AI.CommandItem>
            <Pen.AI.CommandItem command="fix-grammar">Fix grammar</Pen.AI.CommandItem>
          </Pen.AI.CommandList>
        </Pen.AI.CommandMenu>
        <Pen.AI.GenerationZone>
          <Pen.AI.StreamingText />
          <Pen.AI.ActionBar>
            <Pen.AI.ActionBar.Accept>Keep</Pen.AI.ActionBar.Accept>
            <Pen.AI.ActionBar.Reject>Discard</Pen.AI.ActionBar.Reject>
            <Pen.AI.ActionBar.Retry>Retry</Pen.AI.ActionBar.Retry>
          </Pen.AI.ActionBar>
        </Pen.AI.GenerationZone>
      </Pen.AI.Root>
    </Pen.Editor.Root>
  )
}
```

Progressive capability -- same engine, different surface:

```tsx
import { createEditor } from '@pen/core'
import { defaultSchema } from '@pen/schema-default'

// M0: custom schema, M0 extensions auto-included
const editor = createEditor({
  schema: defaultSchema.extend([myCustomBlock]),
})

// After M1: add search and collaboration
// import { search } from '@pen/search'
// import { collaboration } from '@pen/collaboration'
//
// const editor = createEditor({
//   schema: defaultSchema.extend([myCustomBlock]),
//   extensions: [
//     search(),
//     collaboration({ room: 'doc-123' }),
//   ],
// })
```

## Architecture

Three layers: **Schema** (data), **Headless** (behavior), **Rendering** (UI). Each independent and swappable.

```
┌───────────────────────────────────────────────────────────┐
│ Consumer Application                                      │
│                                                           │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Rendering Layer                                      │ │
│  │ (styled components — React, Vue, Svelte, HTML)       │ │
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

## Packages

### Core

| Package | Description |
|---|---|
| `@pen/core` | Extension manager, schema engine, field editor host, selection, decorations, undo, document pool, tool server |
| `@pen/crdt-yjs` | Yjs CRDT adapter (default) |
| `@pen/schema-default` | Default block schemas (paragraph, heading, list, code, image, table, divider, callout, toggle, blockquote) |

### Rendering

| Package | Description |
|---|---|
| `@pen/react` | React primitives, hooks, field editor implementation |

### Extensions

| Package | Description |
|---|---|
| `@pen/document-ops` | Block CRUD, generation zones |
| `@pen/delta-stream` | Streaming protocol, processing pipeline |
| `@pen/undo` | Undo groups, origin tagging, field editor integration |
| `@pen/import-html` | HTML importer with sanitization |
| `@pen/import-markdown` | Markdown importer |

### Transports

| Package | Description |
|---|---|
| `@pen/transport-sse` | Server-Sent Events transport |
| `@pen/transport-direct` | In-process transport |

### Providers

| Package | Description |
|---|---|
| `@pen/mcp` | MCP tool server for bidirectional protocol clients |

See `packages/providers/mcp/README.md` for `stdio`, Streamable HTTP, and SSE wiring examples.

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
5. **Scaffold an app.** Once M0 packages are published: `npx @pen/cli create my-editor` scaffolds a React + Vite app with the default editor. The bootstrap scaffold is an M0 requirement (see DX Sequencing in `spec/v01.md` Section 21); full CLI features ship in Wave 9.
6. **Explore the spec.** Start with `spec/v01.md` for architecture and design principles, then dive into wave specs (`spec/wave-00-foundation-types.md` onward) for implementation details.

### Spec Navigation

| Document | What it covers |
|---|---|
| `spec/v01.md` | Full technical specification: architecture, types, schema, selection, extensions, streaming, milestones |
| `spec/wave-00-foundation-types.md` | `@pen/types` — type definitions, `prop` builder, `defineBlock`, `defineExtension` |
| `spec/wave-01-crdt-layer.md` | `@pen/crdt-yjs` — Yjs adapter, CRDT events, conflict resolution |
| `spec/wave-02-schema-engine.md` | Schema engine, normalization, `BlockHandle` API, default schema, `@pen/test` |
| `spec/wave-03-editor-core.md` | `createEditor()`, apply pipeline, extensions, undo, streaming |
| `spec/wave-04-transports-importers.md` | SSE/direct transports, markdown/HTML importers and exporters |
| `spec/wave-05-react-rendering.md` | React primitives, field editor, hooks, toolbar, clipboard |
| `spec/wave-06-mcp-bench-integration.md` | MCP server, benchmarks, M0 exit criteria |
| `spec/wave-07-ai-track-changes.md` | AI extension, suggestions, track changes |
| `spec/wave-08-collaboration-history.md` | Multiplayer, presence, awareness, version history |
| `spec/wave-09-search-input-rules-cli.md` | Search, input rules, `pen create` CLI |
| `spec/wave-10-layout.md` | Layout containers, flex/grid blocks, responsive stacks |
| `spec/wave-11-apps-execution.md` | Embedded apps, execution sandboxing, document branching |
| `spec/wave-12-production-ecosystem.md` | Auth, rate limiting, Vue/Svelte, Loro, documentation site |
| `spec/errata-ledger.md` | Consolidated errata triage across all waves |

## Milestones

- **M0 -- Core Steel Thread.** Working editor with schema engine, field editor, AI streaming, undo, decorations, and React rendering.
- **M1 -- AI Primitives + Collaboration.** Track changes, version history, search, multiplayer, `pen create` CLI.
- **M2 -- Layout + Apps + Execution.** Structured layout, interactive apps, Docker sandboxing, document branching.
- **M3 -- Production + Ecosystem.** Auth, rate limiting, exporters, Vue/Svelte, Loro adapter, documentation site.

For detailed milestone scope, exit criteria, and decision locks, see `spec/v01.md` Section 21.

## Contributing

Pen is in active development. Contribution guidelines are coming soon.

By contributing to Pen, you agree to the [Contributor License Agreement](CLA.md).

### Pre-build Governance

Before implementation starts on any wave, the following must be satisfied:

- **Errata lock.** All items in `spec/errata-ledger.md` for that wave must be triaged (fixed in spec, implementation-required, or deferred).
- **Diagnostics contract.** All diagnostic emissions must use structured codes per `spec/v01.md` Section 22.
- **API stability.** Public API changes follow the stability policy in `spec/v01.md` Section 23.

## Authors

Pen is created by [Input](https://www.input.so/).

## License

The Pen SDK is provided under the [Pen license](LICENSE.md). You can use the SDK freely in development. Production use requires a license. Contact [input.so](https://www.input.so/) to learn more.

Copyright (c) 2025-present Input B.V.
