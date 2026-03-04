# Pen

Pen is an open-source, headless, extension-first editor engine built for human-AI co-authoring.

It provides unstyled behavioral primitives, a schema-driven block system, and a tool surface that lets any LLM read, write, and manipulate documents. Pen is model-agnostic: a minimal `ModelAdapter` interface works with any LLM client -- including the Vercel AI SDK and its 25+ providers -- while `@pen/mcp` exposes the same tools to bidirectional protocol clients.

Pen provides headless editor primitives and you bring the experience. The rich-text toolbar, the AI command palette, the slash menu, the collaboration cursors -- these are all composable, unstyled behavioral layers that consumers style and assemble.

```
ProseMirror / Lexical       Pen                      TipTap / Plate / BlockNote
(raw engine)           (headless toolkit)            (opinionated toolkit)
◄────────────────────────────┼──────────────────────────────────►
no UI primitives        unstyled behavioral           styled components
build everything        primitives + AI-native        some assembly required
                        CRDT-first, schema-driven     framework-coupled
                        you bring the design          design decisions made
```

## Core Thesis

1. **Headless** -- Behavior and state separated from rendering. Same engine powers Notion-style, Docs-style, Markdown-first, or headless CMS.
2. **AI-native** -- Document model, operation format, and extension architecture designed around how LLMs generate and how humans collaborate with them.
3. **Extension-first** -- Core is tiny. Everything -- blocks, formatting, AI, multiplayer, execution, apps -- is an extension. Extensions have rich lifecycle hooks.
4. **Schema-driven** -- Block types, layout rules, and content defined as declarative schemas. Compile to React, Vue, Svelte, HTML, or SSR without changing the definition.
5. **Binary-first** -- Documents are stored and transmitted as binary CRDT state. JSON, Markdown, and HTML are derived views at serialization boundaries.
6. **CRDT-portable (Yjs-first)** -- Yjs is the default and directly integrated CRDT implementation. The architecture supports future portability to Loro or Automerge, but the abstraction layer hardens based on real adapter implementations, not upfront speculation.

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
│  │ Unstyled behavioral primitives (like Radix/cmdk)     │ │
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


## Milestones

- **M0 -- Core Steel Thread.** Working editor with schema engine, field editor, AI streaming, undo, decorations, and React rendering.
- **M1 -- AI Primitives + Collaboration.** Track changes, version history, search, multiplayer, `pen create` CLI.
- **M2 -- Layout + Apps + Execution.** Structured layout, interactive apps, Docker sandboxing, document branching.
- **M3 -- Production + Ecosystem.** Auth, rate limiting, exporters, Vue/Svelte, Loro adapter, documentation site.

## Contributing

Pen is in active development. Contribution guidelines are coming soon.

## Authors

Pen is created by [Input](https://www.input.so/) and contributed to by [Krijn Rijshouwer](https://x.com/krijnrijshouwer) and [Matteo Gauthier](https://x.com/MatteoGauthier_).

## License

MIT
