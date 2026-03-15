# Pen Public API RFC

**Status:** Proposed

**Related packages:** `@pen/types`, `@pen/core`, `@pen/react`, `@pen/ai`, `@pen/ai-autocomplete`, `@pen/document-ops`, `@pen/ai-tools`, `@pen/ai-skills`, `@pen/database`

**Related docs:** `spec/v01.md`, `spec/wave03EditorCore.md`, `spec/wave05ReactRendering.md`, `spec/aiReviewFirstV2.md`

---

## Goal

Define a cleaner public package contract and editor configuration model for Pen so that:

- the package map matches the architecture story
- the default developer path remains fast and ergonomic
- advanced customization becomes more typed and less implicit
- internal extension plumbing stops leaking into the normal consumer experience
- documentation can teach one canonical integration path

This RFC is about Pen as a product surface, not just Pen as an internal codebase.

---

## Problem Statement

Pen's internal architecture is stronger than its public API.

Today the codebase already shows a useful split between:

- contracts and schemas
- editor runtime and mutation authority
- extensions and tool runtimes
- rendering and UI composition

But the public API still has a few structural problems:

1. `@pen/core` acts as both the runtime package and an informal umbrella package.
2. `createEditor()` is both the minimal kernel constructor and the batteries-included default product entrypoint.
3. default extension customization relies on string names such as `without: string[]`.
4. advanced features expose internal slot patterns and `editor.internals` as practical integration seams.
5. some packages mix headless behavior and React/UI exports in one entrypoint.
6. docs currently imply multiple entrypoints and, in a few places, drift from the actual published API.

The result is an architecture that is solid underneath, but harder to teach, reason about, and evolve safely at the public surface.

---

## Design Principles

1. The package map should explain the product.
2. Easy defaults and true core should both exist, but they should not be conflated.
3. Public configuration should be typed and intention-revealing.
4. Stable product concepts should be exposed before kernel escape hatches.
5. Runtime behavior packages and rendering bindings should stay separable.
6. One canonical happy path should dominate docs and examples.

---

## Non-Goals

This RFC does not attempt to:

- redesign Pen's document model
- replace the extension model
- remove internal slots from the kernel implementation
- define AI workflow product UX
- define chat shells or orchestration surfaces
- require a breaking rewrite of existing packages in one step

This is a surface-clarity and API-hardening RFC, not a foundation reset.

---

## Core Thesis

Pen should present five clear product layers:

1. **Contracts**: `@pen/types`
2. **Runtime kernel**: `@pen/core`
3. **Default batteries-included composition**: `@pen/preset-default`
4. **Feature packages**: `@pen/ai`, `@pen/ai-autocomplete`, `@pen/document-ops`, `@pen/ai-tools`, `@pen/database-core`
5. **Rendering bindings**: `@pen/react`, `@pen/react-ai`, `@pen/database-react`

This preserves Pen's architecture while making its public surface easier to understand:

- `@pen/types` defines the language
- `@pen/core` runs the engine
- `@pen/preset-default` gives the standard Pen stack
- feature packages add behavior
- React packages add UI and rendering

---

## Proposed Package Responsibilities

### `@pen/types`

Purpose:

- zero-dependency contracts
- schema and block definitions
- editor, ops, transport, and extension interfaces
- low-level builders that are safe across the repo

Public examples:

- `Editor`
- `DocumentOp`
- `SchemaRegistry`
- `defineBlock`
- `defineExtension`
- `ToolRuntime`
- `PenTransport`

Rules:

- no runtime implementations
- no React dependencies
- no product-level convenience behavior

`@pen/types` remains the safest package to depend on from anywhere in the monorepo.

### `@pen/core`

Purpose:

- headless editor kernel
- mutation authority
- normalization and selection
- document state
- extension lifecycle
- document session management

Public examples:

- `createEditor`
- `createDocumentSession`
- runtime-facing editor APIs

Rules:

- do not re-export the entire `@pen/types` surface
- do not imply the full default Pen stack by default
- expose typed capability accessors rather than raw slot usage where possible

### `@pen/preset-default`

Purpose:

- package the default Pen experience
- hold batteries-included extension composition
- define the stable names and config for default features

Initial default preset ownership:

- document ops
- delta stream
- undo
- rich text shortcuts

This package resolves the current tension between "Pen core is tiny" and "createEditor() installs a default stack."

### `@pen/react`

Purpose:

- primary React rendering bindings for the editor surface
- editor primitives, renderers, hooks, and composition helpers

Rules:

- keep the editor rendering story first-class
- avoid becoming the umbrella package for every feature integration
- move feature-specific React bindings into optional React packages when they create meaningful surface growth

### `@pen/react-ai`

Purpose:

- React bindings for AI UI primitives
- feature-specific visual composition on top of `@pen/ai`

This package is optional but recommended if AI primitives continue to expand.

### `@pen/database-core`

Purpose:

- headless database extension behavior
- controllers, schema helpers, mutation logic

### `@pen/database-react`

Purpose:

- database renderers and React/UI primitives

Splitting database is recommended because it currently mixes extension logic, engine behavior, renderers, hooks, and React primitives in one package.

### `@pen/document-ops`, `@pen/ai-tools`, `@pen/ai-skills`

This stack is directionally correct already and should be preserved:

- `@pen/document-ops`: low-level document semantics and runtime helpers
- `@pen/ai-tools`: canonical public tool runtime and execution surface
- `@pen/ai-skills`: agent-facing packaging of those tools

This package ladder is a good model for the rest of Pen.

---

## Canonical Import Story

Pen should teach one canonical import model:

```ts
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { PenEditor, Pen } from "@pen/react";
import { aiExtension } from "@pen/ai";
import { autocompleteExtension } from "@pen/ai-autocomplete";
```

Interpretation:

- runtime comes from `@pen/core`
- defaults come from `@pen/preset-default`
- rendering comes from `@pen/react`
- behavior comes from feature packages

The docs should avoid namespace import patterns like `import * as Pen from "@pen/react"` if the package is actually exporting a named `Pen` object.

---

## Proposed `createEditor()` Contract

### Current pain points

The current `createEditor()` API blends together:

- core runtime construction
- default product composition
- advanced extension customization

That makes it convenient for onboarding, but muddy for architecture and awkward for advanced consumers.

### Proposed shape

```ts
export interface CreateEditorOptions {
  schema?: SchemaRegistry;
  preset?: EditorPreset;
  extensions?: Extension[];
  crdt?: CRDTAdapter;
  assets?: AssetProvider;
  document?: CRDTDocument;
  documentSession?: DocumentSession;
  documentScopeId?: string;
  documentProfile?: DocumentProfile;
  editorViewMode?: EditorViewMode;
}
```

### Behavioral contract

- `createEditor()` with no `preset` creates a minimal headless kernel.
- `createEditor({ preset: defaultPreset() })` creates the standard Pen runtime.
- `extensions` always add or override behavior explicitly on top of the selected preset.

This makes the architecture honest:

- the kernel is the kernel
- the default Pen experience is a composition package

---

## Proposed Default Preset API

The default preset should replace `without: string[]` with typed configuration.

### Example

```ts
const editor = createEditor({
  preset: defaultPreset({
    documentOps: true,
    deltaStream: true,
    undo: true,
    shortcuts: {
      enabled: true,
      onToggleLink,
    },
  }),
  extensions: [
    aiExtension({ model }),
    autocompleteExtension({ model }),
  ],
});
```

### Why this is better

- no string-based feature removal
- no knowledge of internal extension names required
- easier docs
- easier migration
- clearer ownership of default behavior

### Alternative considered

A chainable preset builder:

```ts
const preset = defaultPreset()
  .without("shortcuts")
  .with(richTextShortcutsExtension({ onToggleLink }));
```

This is still better than the current state, but it keeps string-based removal alive and should only be considered if a fluent builder materially improves ergonomics.

The typed object config is preferred.

---

## Typed Capabilities Instead Of Product-Level Slot Usage

### Current issue

Pen's kernel slots are useful, but they currently leak into real consumer and feature integration patterns.

That is acceptable as an internal implementation strategy. It is not an ideal product-facing integration model.

### Proposed direction

Expose typed capabilities or stable accessors for installed feature seams.

Two acceptable models:

#### Option A: capability bag

```ts
const editor = createEditor({
  preset: defaultPreset(),
  extensions: [aiExtension({ model }), autocompleteExtension({ model })],
});

editor.capabilities.ai?.start(...);
editor.capabilities.autocomplete?.setEnabled(true);
editor.capabilities.tools?.execute(...);
```

#### Option B: stable accessors

```ts
const ai = getAIController(editor);
const autocomplete = getAutocompleteController(editor);
const tools = getAIToolRuntime(editor);
```

Option B is closer to the current codebase and can likely be adopted incrementally first.

### Required rule

Normal docs and examples should never require direct use of:

- `editor.internals.getSlot(...)`
- `editor.internals.setSlot(...)`
- raw slot key constants

Those remain internal or advanced-only mechanisms.

---

## Public `Editor` Interface Guidance

The public `Editor` interface should be optimized for normal consumers first.

That means:

- mutation
- selection
- document access
- event subscriptions
- undo
- typed capability access

The kernel-facing internals should either:

1. move behind an explicitly unstable property such as `__unsafeInternals`, or
2. remain on `internals` but be documented as unstable and excluded from normal integration guidance

The current surface can remain for compatibility, but the product direction should demote internals from the primary story.

---

## React Surface Recommendations

### `@pen/react`

Keep:

- `PenEditor`
- `Pen`
- core editor hooks
- renderer overrides
- editor contexts required for composition

Reduce or isolate:

- field editor internal helpers that are only useful to extension authors
- feature-specific UI surfaces that materially expand package scope

### AI React bindings

If the AI surface continues to grow, move AI UI primitives into `@pen/react-ai`.

This keeps:

- `@pen/ai` as the behavior package
- `@pen/react-ai` as the rendering package

That model is more consistent with Pen's architecture and scales better than growing `@pen/react` indefinitely.

---

## Database Package Split Recommendation

Database is the strongest candidate for a package split.

### Current concern

One package currently mixes:

- extension registration
- engine logic
- renderers
- controller hooks
- React primitives

### Recommended split

- `@pen/database-core`
- `@pen/database-react`

### Benefits

- restores headless versus rendering clarity
- simplifies dependency direction
- makes database easier to adopt in non-React futures
- aligns with Pen's stated architecture

---

## Documentation Strategy

### Problem

The README is carrying too much weight:

- marketing
- quickstart
- architecture
- feature cookbook
- milestone roadmap

That encourages drift and weakens trust.

### Recommended doc structure

#### `README.md`

Keep it focused on:

- what Pen is
- 60-second quickstart
- package map
- links to deeper docs

#### `docs/quickstart.md`

Single canonical happy path:

- install packages
- create an editor
- render with `PenEditor`
- switch to `Pen` composition
- add AI behavior
- customize default preset

#### `docs/architecture.md`

Explain:

- contracts
- core runtime
- presets
- feature packages
- rendering bindings

#### `docs/extensions.md`

Explain:

- how to add feature packages
- how default preset config works
- when to use stable capability accessors
- when advanced internals are appropriate

### Documentation rules

1. Every snippet must compile against the current exported surface.
2. Docs should teach named imports that match the real package entrypoints.
3. Docs should prefer typed product concepts over internal plumbing concepts.
4. Advanced examples should build from the same base setup as the quickstart.

---

## Example API Transition

### Current style

```ts
const editor = createEditor({
  preset: defaultPreset({
    shortcuts: false,
  }),
  extensions: [
    aiExtension({ model }),
    autocompleteExtension({ model }),
    richTextShortcutsExtension({ onToggleLink }),
  ],
});
```

### Proposed style

```ts
const editor = createEditor({
  preset: defaultPreset({
    shortcuts: {
      enabled: true,
      onToggleLink,
    },
  }),
  extensions: [
    aiExtension({ model }),
    autocompleteExtension({ model }),
  ],
});
```

The proposed style is better because it:

- removes internal extension-name coupling
- makes the default stack explicit
- clarifies which behavior is default versus app-specific
- gives docs a stable shape to teach

---

## Migration Strategy

This RFC should land incrementally.

### Phase 1: Surface accuracy

- fix README examples to match actual exports
- standardize on named `Pen` imports
- remove examples that imply unsupported props or symbols
- document the current best-practice happy path

This phase is high-priority and low-risk.

### Phase 2: Add better APIs without breaking callers

- add `preset` support to `createEditor()`
- introduce `@pen/preset-default`
- keep current default wiring temporarily for compatibility
- add stable capability accessors where product seams already exist

### Phase 3: Deprecate weak seams

- deprecate `without`
- de-emphasize direct public use of `editor.internals`
- stop teaching slot key usage in product docs

### Phase 4: Package clarity improvements

- split database into core and React packages
- optionally split AI React bindings out of `@pen/react`
- selectively reduce top-level `@pen/react` surface sprawl

### Phase 5: Tighten long-term boundaries

- remove wildcard re-export of `@pen/types` from `@pen/core`
- make contracts/runtime imports semantically meaningful again

This final phase should wait until the improved path is stable and documented.

---

## Compatibility Notes

The migration strategy intentionally avoids a flag day.

Recommended compatibility rules:

- old code using current `createEditor()` should continue to work for at least one milestone
- `without` should emit deprecation guidance before removal
- stable accessors should be introduced before internals-based examples are retired
- package splits should preserve compatibility entrypoints or codemod-friendly re-exports during transition

---

## Success Criteria

This RFC succeeds if:

1. a new user can explain the purpose of each top-level package after reading the quickstart
2. the docs show one dominant integration path rather than several equal ones
3. customizing default editor behavior no longer requires internal extension names
4. advanced feature integrations can be done through stable accessors instead of direct slot plumbing
5. the package map reinforces, rather than undermines, Pen's headless architecture story

---

## Open Questions

1. Should `createEditor()` without a preset become truly minimal immediately, or should the current default stack remain until a later major version?
2. Should AI React bindings split now, or only after the AI surface grows further?
3. Should `editor.internals` become explicitly unstable in naming, or remain public but discouraged?
4. Does `@pen/database` need a real package split now, or would subpath exports be enough as a transition?
5. Should `@pen/core` re-export a narrow convenience type set, or stop re-exporting from `@pen/types` entirely?

---

## Recommendation

Adopt this RFC in three practical moves first:

1. fix docs drift immediately
2. introduce `@pen/preset-default` and `preset` support
3. deprecate `without` in favor of typed default feature config

Those changes deliver the highest architectural clarity for the least disruption.
