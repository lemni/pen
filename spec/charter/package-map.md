# Package Map

## Purpose

Provide a stable overview of the workspace layout and the spec paths that mirror it.

## Areas

- `packages/types`: contracts and lightweight helpers
- `packages/core`: headless editor authority
- `packages/schema`: default schema surface
- `packages/presets`: standard runtime presets
- `packages/rendering`: renderer bindings and shared DOM engine
- `packages/extensions`: optional runtime features
- `packages/crdt`: CRDT adapters
- `packages/transports`: transport implementations
- `packages/shared`: lower-level shared support libraries
- `packages/tooling`: testing, benchmarks, and development utilities
- `packages/docs`: repository docs app for the current public Pen surface
- `playground`: integration app and playground for shipped editor flows

## Generated Package Specs

- `@pen/core` -> `packages/core.md`
- `@pen/crdt-yjs` -> `packages/crdt/yjs.md`
- `@pen/docs` -> `packages/docs.md`
- `@pen/ai-autocomplete` -> `packages/extensions/ai-autocomplete.md`
- `@pen/ai-skills` -> `packages/extensions/ai-skills.md`
- `@pen/ai-suggestions` -> `packages/extensions/ai-suggestions.md`
- `@pen/ai-tools` -> `packages/extensions/ai-tools.md`
- `@pen/ai` -> `packages/extensions/ai.md`
- `@pen/database` -> `packages/extensions/database.md`
- `@pen/delta-stream` -> `packages/extensions/delta-stream.md`
- `@pen/document-ops` -> `packages/extensions/document-ops.md`
- `@pen/export-html` -> `packages/extensions/export-html.md`
- `@pen/export-json` -> `packages/extensions/export-json.md`
- `@pen/export-markdown` -> `packages/extensions/export-markdown.md`
- `@pen/export-xml` -> `packages/extensions/export-xml.md`
- `@pen/history` -> `packages/extensions/history.md`
- `@pen/import-html` -> `packages/extensions/import-html.md`
- `@pen/import-markdown` -> `packages/extensions/import-markdown.md`
- `@pen/input-rules` -> `packages/extensions/input-rules.md`
- `@pen/multiplayer` -> `packages/extensions/multiplayer.md`
- `@pen/search` -> `packages/extensions/search.md`
- `@pen/shortcuts` -> `packages/extensions/shortcuts.md`
- `@pen/undo` -> `packages/extensions/undo.md`
- `@pen/preset-default` -> `packages/presets/default.md`
- `@pen/dom` -> `packages/rendering/dom.md`
- `@pen/react` -> `packages/rendering/react.md`
- `@pen/vue` -> `packages/rendering/vue.md`
- `@pen/schema-default` -> `packages/schema/default.md`
- `@pen/content-ops` -> `packages/shared/content-ops.md`
- `@pen/markdown-serialization` -> `packages/shared/markdown-serialization.md`
- `@pen/assets-memory` -> `packages/tooling/assets-memory.md`
- `@pen/bench` -> `packages/tooling/bench.md`
- `@pen/test` -> `packages/tooling/test.md`
- `@pen/transport-direct` -> `packages/transports/direct.md`
- `@pen/transport-sse` -> `packages/transports/sse.md`
- `@pen/types` -> `packages/types.md`
- `@pen/playground` -> `packages/playground.md`
