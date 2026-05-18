# Pen Specs

This spec set describes Pen as it exists in the monorepo today. It is package-centric and current-state oriented rather than roadmap-driven.

## How To Read This

Start with the charter docs if you want the durable architectural rules:

- `charter/architecture.md`
- `charter/document-model.md`
- `charter/mutation-pipeline.md`
- `charter/package-map.md`

Then read package specs by layer:

- Runtime authority: `packages/core.md`, `packages/types.md`
- Rendering: `packages/rendering/dom.md`, `packages/rendering/react.md`, `packages/rendering/vue.md`
- Editing and extensions: `packages/extensions/search.md`, `packages/extensions/undo.md`, `packages/extensions/history.md`, `packages/extensions/multiplayer.md`
- AI and tooling: `packages/extensions/ai.md`, `packages/extensions/document-ops.md`, `packages/shared/content-ops.md`
- Import/export: `packages/extensions/import-markdown.md`, `packages/extensions/import-html.md`, `packages/extensions/export-json.md`, `packages/extensions/export-xml.md`

## Structure

- `charter/` contains cross-cutting architectural invariants.
- `packages/` mirrors the workspace package and app layout.
- Package specs stay close to real package boundaries instead of grouping work by milestone or wave.
- `roadmap/` contains explicit forward-looking plans that have not yet been folded into package specs.

## Core Conventions

- Runtime authority lives with `@pen/core` and the `Editor` API.
- `DocumentOp[]` and `editor.apply(...)` remain the canonical mutation path.
- `@pen/types` is the shared contract layer, not a hidden runtime layer.
- Renderer packages bind to the editor runtime but do not own document truth.
- JSON is the canonical machine-readable format. XML is an interoperability surface layered on top of that model.
- React is the primary documented renderer. Vue is a shipped renderer proof built on the shared DOM engine.
- Private apps such as `@pen/docs` and `@pen/playground` are specified because they are part of the workspace, but they are not publishable runtime packages.

## What Changed

- Historical wave docs and planning notes were removed.
- Specs now describe the workspace as shipped today.
- The highest-value packages now have deeper runtime notes, boundaries, and architecture diagrams rather than just metadata summaries.

## Roadmap Specs

- `roadmap/headless-collaboration-ai-waves.md`: generic Pen primitives for CRDT state barriers, structured mutation groups, headless server editors, export hooks, field adapters, and deterministic fixtures.
