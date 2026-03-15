# RFC — `@pen/ai-autocomplete`

**Status:** Proposed

**Proposed package:** `@pen/ai-autocomplete`

**Related packages:** `@pen/ai`, `@pen/react`, `@pen/ai-skills`, `@pen/bench`

**Depends on:** Wave 3, Wave 5, Wave 6, Wave 7

---

## Goal

Ship a dedicated low-latency inline autocomplete system for Pen.

After this RFC:

- Pen can show local-only gray ghost text while the user types
- `Tab` accepts a visible completion
- when no completion is visible, `Tab` can explicitly trigger autocomplete
- repeated `Tab` can accept a completion progressively
- consumers can inject bounded custom context without slowing the typing hot path
- accepted completions still enter the document through the canonical `editor.apply()` pipeline

The user-facing inspiration is Cursor/Copilot-style autocomplete. The architectural goal is different: Pen should implement that UX in a way that stays headless, extension-first, CRDT-safe, and fast under cancellation churn.

---

## Executive Summary

The original idea is correct, but the optimal architecture is:

1. extract a small shared inline-completion primitive from the current `@pen/ai` ephemeral suggestion path
2. make `@pen/react` own all `Tab` precedence in the field editor
3. make `@pen/ai-autocomplete` own inference, scheduling, prompt building, provider execution, and metrics
4. use providers for live autocomplete context and skills for packaging/documentation, not runtime execution
5. use client-side sequence segmentation and post-accept prefetch rather than requiring the model to emit explicit sequence units

This package therefore does **not** own raw keyboard precedence and does **not** run the generic tool loop on keypress.

---

## Why This Should Exist

Pen already has useful pieces:

- `@pen/react` owns the field editor, DOM backends, and text key handling
- `@pen/ai` already has local-only ephemeral suggestion state and accept/dismiss behavior
- `@pen/ai-skills` already packages Pen-native AI behavior for external agent ecosystems
Those pieces are not enough by themselves because typing autocomplete has a different operating envelope than prompt-driven AI:

- requests must be cheap to start and cheap to cancel
- the prompt must stay small and local
- `Tab` has existing editor meaning and cannot be intercepted globally
- the system must survive composition, selection churn, undo/redo, and remote edits
- the hot path cannot afford tool-calling, planning, or broad document retrieval

`@pen/ai-autocomplete` is the dedicated package for that problem.

---

## What Changes From The Earlier Draft

This RFC intentionally tightens the architecture:

- `Tab` precedence moves fully into `@pen/react` field-editor handling
- autocomplete no longer owns a ghost-text bridge directly inside the package boundary; it builds on a shared inline-completion primitive
- provider hooks are the runtime extension point
- skill artifacts are export and DX surfaces only
- sequence acceptance is a client normalization strategy over a plain completion tail
- the hot path avoids `@pen/document-ops` formatting/tool execution by default

---

## Non-Goals

- This package does not replace `@pen/ai` sessions, inline edit, review flow, or persistent suggestions.
- This package does not persist autocomplete state into the CRDT.
- This package does not run agentic tool loops, plan validation, or broad document search in the typing path.
- This package does not own low-level DOM editing or keyboard precedence.
- This package does not require a styled UI layer.
- This package does not ship multi-candidate cycling in v1.

---

## Core Behavior

### Visible Completion

- A single local-only completion is visible per editor instance.
- It renders as gray ghost text decoration.
- It never changes persisted document content until accepted.

### Acceptance

- `Tab` accepts the current visible completion.
- In sequence mode, each `Tab` accepts only the next segment.
- After a partial accept, the remaining tail stays visible if still valid.
- After a partial accept, the system may prefetch a fresh continuation from the new cursor position.

### Explicit Trigger

- If no completion is visible, `Tab` may explicitly trigger autocomplete.
- This only happens if the current context is eligible and no higher-priority editor meaning owns the key.

### Invalidation

- Typing
- `Backspace`
- `Delete`
- `Enter`
- composition start
- selection expansion
- incompatible caret movement
- external block edit

must dismiss the visible completion.

---

## Architectural Principles

1. **Field editor owns text semantics.**
2. **Autocomplete owns inference and scheduling.**
3. **A shared inline-completion primitive owns local ghost state.**
4. **Providers are runtime context.**
5. **Skills are packaging and DX.**
6. **Everything accepted writes through `editor.apply()`.**
7. **Cancellation is normal.**
8. **IME safety beats eagerness.**
9. **Prompt size is aggressively bounded.**
10. **The default path is local and cheap.**

---

## Package Responsibilities

`@pen/ai-autocomplete` is responsible for:

- observing eligible editor commits and selection changes
- deciding when to schedule autocomplete
- building a minimal completion request
- collecting provider context within strict budgets
- starting and cancelling model requests
- normalizing returned text into acceptance segments
- publishing updates to the shared inline-completion primitive
- tracking metrics and diagnostics
- exposing provider descriptors for optional skill packaging

It is not responsible for:

- deciding whether `Tab` means indent, table navigation, accept, or trigger
- rendering the field editor
- maintaining prompt-session state
- executing Pen tools in the hot path
- generating persistent track-changes artifacts

---

## Package Boundaries

### Shared Primitive

Before `@pen/ai-autocomplete` lands, Pen should extract a small shared inline-completion primitive out of the existing `@pen/ai` ephemeral suggestion path.

That primitive owns:

- current visible suggestion
- local-only decoration payload
- accept
- dismiss
- update
- sequence remainder state

This primitive may live temporarily in `@pen/ai`, but it must not remain buried inside the main `AIControllerImpl` session controller.

### `@pen/react`

`@pen/react` owns:

- field-editor keyboard precedence
- wiring `Tab` accept and explicit trigger into the autocomplete controller
- any selection-safe decoration rendering behavior needed by the field editor

### `@pen/ai-autocomplete`

`@pen/ai-autocomplete` owns:

- controller
- scheduler
- trigger policy
- prompt builder
- provider registry
- sequence normalization
- prefetch policy
- metrics

### `@pen/ai-skills`

`@pen/ai-skills` may package:

- provider descriptors
- debugging instructions
- installation guidance

It does not execute autocomplete behavior.

---

## Public API

```ts
import { createEditor } from "@pen/core";
import { autocompleteExtension } from "@pen/ai-autocomplete";

const editor = createEditor({
  extensions: [
    autocompleteExtension({
      model,
      trigger: {
        enabled: true,
        debounceMs: 80,
        explicitTab: true,
        prefetchAfterAccept: true,
      },
      acceptance: {
        strategy: "sequence",
      },
    }),
  ],
});
```

### Exports

```ts
export function autocompleteExtension(
  config?: AutocompleteExtensionConfig,
): Extension;

export function getAutocompleteController(
  editor: Editor,
): AutocompleteController | null;

export function createAutocompleteProvider(
  provider: AutocompleteContextProvider,
): AutocompleteContextProvider;

export const AUTOCOMPLETE_EXTENSION_NAME: "ai-autocomplete";
export const AUTOCOMPLETE_CONTROLLER_SLOT: string;
```

---

## File Structure

```text
packages/extensions/ai-autocomplete/src/
├── extension.ts
├── controller.ts
├── scheduler.ts
├── triggerPolicy.ts
├── promptBuilder.ts
├── sequence.ts
├── metrics.ts
├── diagnostics.ts
├── providers/
│   ├── registry.ts
│   ├── builtins.ts
│   ├── descriptors.ts
│   └── types.ts
├── integrations/
│   ├── inlineCompletion.ts
│   ├── fieldEditorState.ts
│   └── localContext.ts
├── types.ts
└── index.ts
```

### Companion Work Outside The Package

```text
packages/extensions/ai/src/
└── shared inline-completion primitive extraction

packages/rendering/react/src/field-editor/
└── Tab precedence integration

packages/extensions/ai-skills/src/
└── provider descriptor packaging

packages/tooling/bench/src/
└── autocomplete benchmarks
```

---

## Import DAG

```text
types.ts                    ← (@pen/core)
providers/types.ts          ← types.ts
providers/descriptors.ts    ← providers/types.ts
providers/registry.ts       ← providers/types.ts, diagnostics.ts
integrations/fieldEditorState.ts ← (@pen/core)
integrations/localContext.ts ← (@pen/core)
sequence.ts                 ← types.ts
triggerPolicy.ts            ← types.ts
metrics.ts                  ← types.ts
promptBuilder.ts            ← types.ts, providers/registry.ts, integrations/localContext.ts
scheduler.ts                ← types.ts, metrics.ts
integrations/inlineCompletion.ts ← (@pen/ai or shared primitive), sequence.ts, types.ts
controller.ts               ← types.ts, scheduler.ts, triggerPolicy.ts, promptBuilder.ts, sequence.ts, metrics.ts, integrations/*
extension.ts                ← controller.ts, (@pen/core)
index.ts                    ← extension.ts, controller.ts, providers/*, types.ts
```

No cycles.

`@pen/ai-autocomplete` may depend on a shared inline-completion primitive extracted from `@pen/ai`, but `@pen/ai` must not depend on `@pen/ai-autocomplete`.

---

## Key Precedence

`Tab` must be resolved in the field editor in this exact order:

1. table cell navigation
2. list indentation / outdent
3. accept visible autocomplete suggestion
4. explicitly trigger autocomplete if allowed and no suggestion is visible
5. fall through to normal editor behavior

This order is mandatory.

Autocomplete must not rely on a global document listener to own `Tab`. The global interception pattern is acceptable for the current stopgap ephemeral implementation but is not the target architecture for production autocomplete.

---

## Trigger Model

Autocomplete should trigger from committed editor state, not backend-specific DOM events.

### Primary Inputs

- `editor.onDocumentCommit(...)`
- `editor.onSelectionChange(...)`
- field-editor state from the existing field-editor slot

### Eligible Context

A request may only be scheduled when:

- the extension is enabled
- the field editor is active and focused
- the field editor is not composing
- the selection is a collapsed text selection
- the selection is within a single block
- the active block type is allowed
- the document is not in a conflicting block-level state

### Default Trigger Policy

```ts
{
  enabled: true,
  debounceMs: 80,
  explicitTab: true,
  triggerOnTyping: true,
  prefetchAfterAccept: true,
}
```

### Explicit `Tab` Trigger

When the user presses `Tab` and no completion is visible:

- if the current context is eligible, the field editor calls `controller.request({ explicit: true })`
- if the context is not eligible, the field editor continues with normal behavior

---

## Hot-Path Context Strategy

The typing path must be local-first.

### Default Prompt Inputs

The default prompt builder uses only:

- block type
- active block prefix
- active block suffix
- small previous-block preview
- small next-block preview
- optionally cheap heading path context

This data should come directly from editor/block APIs, not from generic tool execution or expensive markdown serialization.

### Context Rules

- default context must be synchronous
- default context must be bounded by character limits
- no full-document serialization in the typing path
- no broad retrieval or semantic search in the typing path

---

## Provider Architecture

Providers are the runtime extension point for custom autocomplete context.

### Why Providers

Consumers do need custom context. The runtime problem is not "how do we make context possible?" but "how do we make context possible without destroying latency?"

Providers are preferred over tools because they are:

- typed
- bounded
- local to the editor runtime
- easier to budget and cache
- easier to disable or degrade safely

### Provider Rules

- providers run in priority order
- providers must be read-only
- provider failures are non-fatal
- provider output is size-capped
- the default v1 path assumes sync or cache-backed providers
- cold async I/O is out of scope for the default typing path

### v1 Guidance

For v1, provider implementations should be one of:

- synchronous local state lookups
- cached consumer metadata
- cheap block/schema-derived context

### Provider Interface

```ts
export interface AutocompleteContextProvider {
  id: string;
  priority?: number;
  maxChars?: number;
  when?(ctx: AutocompleteRequestContext): boolean;
  provide(ctx: AutocompleteRequestContext): string | null | Promise<string | null>;
  describe?(): AutocompleteProviderDescriptor;
}
```

Even though `provide()` may return a promise, the package should treat slow providers as optional and budgeted. Missing provider output is preferable to typing-latency regression.

---

## Runtime Tooling Boundary

### Runtime Tooling

The autocomplete hot path must not execute the generic Pen tool loop.

That means:

- no `ToolRuntime.executeTool(...)` in the default request path
- no planner lane
- no model tool-calling loop
- no `@pen/document-ops` tool surface in the typing path

### Skill Packaging

`@pen/ai-skills` is still valuable here, but only for:

- packaging provider descriptors
- documenting custom autocomplete context available in a consumer app
- generating helper references and scripts for agent debugging

Skill artifacts are not part of live autocomplete execution.

---

## Sequence Model

The product should support Cursor-style progressive acceptance, but the sequence abstraction should be client-owned.

### Source Of Truth

The model returns a plain completion tail.

The client then:

- trims and validates it
- removes obvious prefix echo
- segments it into acceptance units
- displays the whole remaining tail
- accepts one segment at a time in sequence mode

### Why Client-Side Segmentation

This is better than requiring sequence-shaped model output because:

- the prompt stays simpler
- segmentation can evolve without changing the model contract
- consumer tuning is local
- acceptance boundaries can be specialized by block type

### Default Segmentation Rules

Prefer boundaries at:

- newline
- sentence punctuation
- clause punctuation
- word boundaries

Example:

```ts
" the engine, then updates the preview."
```

may normalize to:

```ts
[" the engine", ", then", " updates the preview."]
```

### Partial Accept Prefetch

After a partial accept, the system may immediately prefetch a fresh continuation from the updated cursor position. This is the preferred way to keep momentum after the user commits to the direction of travel.

---

## Prompt Construction

Autocomplete prompts should be plain, small, and stable.

### Required Inputs

- block type
- text before cursor
- text after cursor
- tiny local neighborhood
- optional provider snippets

### Required Limits

- hard max prompt size
- hard max completion size
- hard max provider contribution
- hard max provider latency budget

### Prompt Rules

- avoid chat-style wrappers unless needed by the adapter
- avoid document-wide examples by default
- prefer deterministic field labels over long prose instructions
- omit provider output if the budget is exceeded

---

## Shared Inline-Completion Primitive

This RFC depends on extracting a shared primitive from the current ephemeral suggestion path.

### Responsibilities

The primitive should own:

- the currently visible local inline suggestion
- decoration payloads for rendering
- sequence remainder state
- accept
- dismiss
- update

### Design Constraint

The primitive must not be tied to:

- `AIControllerImpl` session state
- command menus
- prompt history
- track changes

It should be usable by both:

- `@pen/ai` inline edit / ephemeral flows
- `@pen/ai-autocomplete`

---

## Acceptance Path

Accepted autocomplete text must always flow through:

```ts
editor.apply(ops, { origin: "ai", undoGroup: true })
```

### Rules

- no direct CRDT mutation bypass
- no DOM-only accept
- no special acceptance pipeline outside `editor.apply()`

This keeps autocomplete aligned with undo, diagnostics, observers, and future instrumentation.

### Undo and redo requirement

Autocomplete acceptance must remain a normal document history action.

That means:

- accepted text must be replayable through the normal undo manager
- partial sequence accepts should remain coherent under repeated undo and redo
- autocomplete must not introduce a second acceptance history outside document history
- local ghost-text state and any ephemeral UI affordances must never intercept undo or redo ahead of normal document history

---

## Invalidation Rules

A visible suggestion must dismiss when:

- the user types visible text
- the user presses `Backspace`
- the user presses `Delete`
- the user presses `Enter`
- the selection becomes non-collapsed
- the selection crosses blocks
- composition starts
- the active block changes
- an external edit affects the anchor block
- the result becomes stale

History operations may preserve a suggestion only if the anchor can be revalidated cheaply. The default policy should be conservative.

---

## IME And Mobile Policy

Composition safety is a hard requirement.

### Required Behavior

- do not request autocomplete during composition
- dismiss visible completions when composition starts
- do not accept completions during composition
- wait for committed text before scheduling again

### Mobile

Mobile-capable surfaces may use stricter defaults:

- proactive autocomplete may be disabled
- explicit `Tab` trigger may be unavailable
- prefetch-after-accept may be disabled

The package should support this through configuration, but the default correctness rule remains: do not interfere with composition candidate flows.

---

## Scheduler And Staleness

Cancellation churn is expected.

### Request Lifecycle

1. observe eligible commit or explicit trigger
2. debounce
3. snapshot anchor and block revision
4. collect prompt inputs
5. start request
6. if stale or cancelled, drop result
7. normalize completion tail into segments
8. publish to the shared inline-completion primitive

### Stale Result Conditions

A result is stale if:

- the active block changed
- the selection changed incompatibly
- the field editor started composing
- the anchor revision changed
- the configured staleness window elapsed

Stale results must be discarded before render whenever possible.

---

## Types

```ts
export interface AutocompleteExtensionConfig {
  model?: ModelAdapter;
  enabled?: boolean;
  trigger?: AutocompleteTriggerPolicy;
  acceptance?: AutocompleteAcceptancePolicy;
  providers?: readonly AutocompleteContextProvider[];
  blockPolicy?: AutocompleteBlockPolicy;
  budgets?: AutocompleteBudgetConfig;
  diagnostics?: boolean;
}

export interface AutocompleteTriggerPolicy {
  enabled: boolean;
  debounceMs: number;
  explicitTab: boolean;
  triggerOnTyping?: boolean;
  prefetchAfterAccept?: boolean;
}

export interface AutocompleteAcceptancePolicy {
  strategy: "full" | "sequence";
  maxSegments?: number;
  minSegmentChars?: number;
}

export interface AutocompleteBlockPolicy {
  allowedBlockTypes?: readonly string[];
  deniedBlockTypes?: readonly string[];
  allowInCodeBlocks?: boolean;
  allowInTables?: boolean;
}

export interface AutocompleteBudgetConfig {
  maxPromptChars: number;
  maxCompletionChars: number;
  maxProviderChars: number;
  maxProviderTimeMs: number;
  maxEndToEndMs: number;
  staleAfterMs: number;
}

export interface AutocompleteRequestContext {
  editor: Editor;
  blockId: string;
  blockType: string | null;
  prefixText: string;
  suffixText: string;
  requestId: string;
}

export interface AutocompleteProviderDescriptor {
  id: string;
  description: string;
  kind?: "local" | "consumer";
}

export interface AutocompleteContextProvider {
  id: string;
  priority?: number;
  maxChars?: number;
  when?(ctx: AutocompleteRequestContext): boolean;
  provide(ctx: AutocompleteRequestContext): string | null | Promise<string | null>;
  describe?(): AutocompleteProviderDescriptor;
}

export interface AutocompleteSequence {
  id: string;
  blockId: string;
  offset: number;
  fullText: string;
  remainingText: string;
  segments: readonly string[];
  acceptedSegments: number;
}

export interface AutocompleteState {
  enabled: boolean;
  status: "idle" | "scheduled" | "requesting" | "showing";
  activeRequestId: string | null;
  activeSequence: AutocompleteSequence | null;
  metrics: AutocompleteMetrics;
}

export interface AutocompleteMetrics {
  requestCount: number;
  successCount: number;
  cancelCount: number;
  staleDropCount: number;
  explicitTabTriggerCount: number;
  acceptCount: number;
  partialAcceptCount: number;
}

export interface AutocompleteController {
  getState(): AutocompleteState;
  subscribe(listener: () => void): () => void;
  request(options?: { explicit?: boolean }): Promise<void>;
  accept(): boolean;
  dismiss(reason?: AutocompleteDismissReason): void;
  setEnabled(enabled: boolean): void;
  registerProvider(provider: AutocompleteContextProvider): () => void;
  listProviderDescriptors(): readonly AutocompleteProviderDescriptor[];
}

export type AutocompleteDismissReason =
  | "typing"
  | "selection-change"
  | "external-edit"
  | "escape"
  | "disabled"
  | "stale"
  | "accept";
```

---

## Performance Contract

`@pen/ai-autocomplete` sits directly on Pen's interactivity SLO surface.

### Required Rules

- autocomplete scheduling overhead must be negligible compared to normal typing
- the package must tolerate rapid request cancellation without memory growth
- provider execution must be bounded
- prompt construction must avoid full-document work
- stale results must not visibly flash

### Target Budgets

- warm-path time to first visible suggestion:
  - p50 <= 150ms
  - p95 <= 400ms
- provider budget:
  - default <= 20ms per provider
  - default <= 40ms combined
- result staleness window:
  - default <= 1500ms

These are targets, not guarantees across every model backend, but the package should be designed around them.

---

## Benchmarks

`@pen/bench` should add:

- `autocomplete-scheduler-overhead`
- `autocomplete-cancel-churn`
- `autocomplete-provider-budget`
- `autocomplete-decoration-refresh`
- `autocomplete-partial-accept`
- `autocomplete-prefetch-after-accept`

These benches should be part of the package's release bar.

---

## Testing Matrix

### Unit Tests

- trigger eligibility
- stale result dropping
- provider ordering and timeout handling
- client-side segmentation
- partial acceptance
- prefetch-after-accept scheduling

### Renderer Tests

- ghost text appears after eligible typing
- `Tab` accepts visible suggestion
- repeated `Tab` accepts progressive segments
- `Tab` triggers autocomplete when no suggestion is visible
- list indentation still works
- table navigation still works
- composition suppresses autocomplete
- external edits dismiss suggestions

### Regression Tests

- no double-apply on rapid `Tab`
- no infinite re-render loops
- no selection drift after accept
- no stale suggestion flash

---

## Developer Experience

This package should feel easy to adopt.

### DX Rules

- zero-config should work with only a `model`
- provider API should be small and typed
- diagnostics should explain why autocomplete is not appearing
- controller state should be observable for custom debug UIs

### Example Provider

```ts
const provider = createAutocompleteProvider({
  id: "route-hint",
  describe: () => ({
    id: "route-hint",
    description: "Adds the current application route to autocomplete context",
  }),
  provide: () => "route=/settings/profile",
});
```

### Playground

The playground should expose:

- enable/disable autocomplete
- debounce control
- full vs sequence acceptance toggle
- prefetch-after-accept toggle
- provider timing information
- live metrics view

---

## Acceptance Criteria

- `@pen/ai-autocomplete` exists as a dedicated package
- Pen extracts a shared inline-completion primitive out of the current `@pen/ai` ephemeral path
- `@pen/react` owns `Tab` precedence for accept and explicit trigger
- visible autocomplete is local-only ghost text
- accepted completions write through `editor.apply(..., { origin: "ai" })`
- accepted completions remain coherent under normal undo and redo replay
- autocomplete does not create a competing undo or redo shortcut path for local UI-only state
- sequence acceptance works through client-side segmentation
- partial accept can prefetch fresh continuation
- runtime custom context uses providers, not generic tools
- provider descriptors can be packaged through `@pen/ai-skills`
- IME/composition suppression works
- benchmark coverage exists for cancellation churn and decoration refresh

---

## Implementation Plan

This feature should land in phases. The order matters because the current codebase already has a usable but coupled ephemeral suggestion path inside `@pen/ai`, and `Tab` behavior is split between the field editor and `Pen.AI.Root`.

The safest path is:

1. extract the shared inline-completion primitive
2. move `Tab` ownership into the field editor
3. add the new `@pen/ai-autocomplete` package
4. wire provider descriptors into `@pen/ai-skills`
5. add playground coverage and benchmarks

Do not start by building the new package against the current `AIControllerImpl` internals. That would harden the wrong boundary.

### Phase 0: Guardrails Before Behavior

Goal:

- make the existing coupling visible in tests before restructuring

Work:

- add or extend tests covering current ephemeral suggestion accept/dismiss behavior
- add field-editor tests for current `Tab` precedence in tables and lists
- add a regression test proving that global `Tab` interception in `Pen.AI.Root` is a temporary behavior to be removed

Primary files:

- `packages/extensions/ai/src/__tests__/extension.test.ts`
- `packages/rendering/react/src/__tests__/fieldEditorCommands.test.ts`
- `packages/rendering/react/src/__tests__/aiPrimitives.test.tsx`
- `packages/rendering/react/src/primitives/ai/root.tsx`

Exit criteria:

- tests clearly describe current behavior and desired future behavior
- we can refactor without losing table/list semantics

### Phase 1: Extract Shared Inline-Completion Primitive

Goal:

- separate local ghost suggestion state from `AIControllerImpl` session flow

Work:

- move `EphemeralSuggestionManager` and related ephemeral suggestion state into a shared primitive or small internal module
- define a minimal interface for:
  - `show`
  - `dismiss`
  - `accept`
  - `subscribe`
  - sequence-aware suggestion payloads
- keep `@pen/ai` using that primitive so existing inline edit behavior continues to work
- remove direct dependence on prompt-session internals where possible

Primary files:

- `packages/extensions/ai/src/suggestions/ephemeral.ts`
- `packages/extensions/ai/src/extension.ts`
- `packages/extensions/ai/src/types.ts`
- `packages/extensions/ai/src/index.ts`
- `packages/rendering/react/src/primitives/ai/suggestion.tsx`
- `packages/extensions/ai/src/decorations/ephemeralRender.ts`

Design notes:

- this phase should preserve current public `@pen/ai` behavior
- the extracted primitive should remain local-only and decoration-based
- do not add autocomplete request logic yet

Exit criteria:

- local inline suggestion state is no longer effectively owned by `AIControllerImpl`
- existing `@pen/ai` tests still pass

#### Phase 1 Contract

Phase 1 should introduce explicit service seams before changing any user-visible behavior.

##### New slot keys

Add these slot keys alongside the existing field-editor and undo slot keys:

```ts
export const AI_CONTROLLER_SLOT = "ai:controller";
export const INLINE_COMPLETION_SLOT = "ai:inline-completion";
export const AI_INLINE_COMPLETION_SLOT = INLINE_COMPLETION_SLOT;
export const AI_INLINE_HISTORY_SLOT = "ai:inline-history";
export const AI_REVIEW_CONTROLLER_SLOT = "ai:review";
```

Design rules:

- `AI_CONTROLLER_SLOT` remains for compatibility during the refactor
- `INLINE_COMPLETION_SLOT` is the generic shared slot for ghost-text state
- `AI_INLINE_COMPLETION_SLOT` remains as a compatibility alias
- new code should prefer the more specific or generic shared slots
- slot ownership should map to one coherent concern per service

##### New service interfaces

Add narrow interfaces in `packages/extensions/ai/src/types.ts`.

```ts
export interface AIInlineCompletionState {
  visibleSuggestion: EphemeralSuggestion | null;
}

export interface AIInlineCompletionController {
  getState(): AIInlineCompletionState;
  subscribe(listener: () => void): () => void;
  showSuggestion(suggestion: EphemeralSuggestion): void;
  dismissSuggestion(): void;
  acceptSuggestion(): boolean;
  hasVisibleSuggestion(): boolean;
}

export type AIInlineHistoryDirection = "undo" | "redo";

export interface AIInlineHistoryController {
  canUndoInlineHistory(): boolean;
  canRedoInlineHistory(): boolean;
  canHandleShortcut(direction: AIInlineHistoryDirection): boolean;
  undoInlineHistory(): boolean;
  redoInlineHistory(): boolean;
}

export interface AIReviewController {
  getSuggestions(): readonly PersistentSuggestion[];
  acceptSuggestion(id: string): boolean;
  rejectSuggestion(id: string): boolean;
  acceptAllSuggestions(): void;
  rejectAllSuggestions(): void;
}
```

Phase 1 intentionally keeps these interfaces small:

- inline completion owns local ghost state only
- inline history owns inline-history replay semantics only
- review controller owns suggestion resolution only

Do not move session/prompt APIs into these smaller interfaces.

##### Compatibility facade

`AIController` remains public during the transition, but becomes a facade over smaller services.

Compatibility rules:

- `getAIController(editor)` continues to work
- `AIController.showEphemeralSuggestion()` delegates to `AIInlineCompletionController.showSuggestion()`
- `AIController.dismissEphemeralSuggestion()` delegates to `AIInlineCompletionController.dismissSuggestion()`
- `AIController.acceptEphemeralSuggestion()` delegates to `AIInlineCompletionController.acceptSuggestion()`
- `AIController.canUndoInlineHistory()` and related methods delegate to `AIInlineHistoryController`
- suggestion resolution methods delegate to `AIReviewController`

The facade should shrink over time. Phase 1 does not remove it.

##### Implementation shape

Create three concrete service objects inside `packages/extensions/ai/src/extension.ts`:

- `AIInlineCompletionService`
- `AIInlineHistoryService`
- `AIReviewService`

They may remain file-local in Phase 1 if that keeps the refactor small, but they must no longer be implicit behavior hidden inside one large controller object.

##### File-by-file Phase 1 checklist

`packages/types/src/constants/slots.ts`

- add the new AI slot keys

`packages/extensions/ai/src/types.ts`

- add the three narrow service interfaces
- keep `AIController` for compatibility
- do not break existing public type exports

`packages/extensions/ai/src/suggestions/ephemeral.ts`

- evolve `EphemeralSuggestionManager` into the backing primitive for `AIInlineCompletionController`
- keep it local-only and decoration-oriented
- do not add autocomplete request logic yet

`packages/extensions/ai/src/extension.ts`

- instantiate the three services explicitly
- register them into their dedicated slots
- keep `AIControllerImpl` only as a facade or compatibility shell
- stop making ephemeral state a private concern owned only by the main controller

`packages/extensions/ai/src/index.ts`

- export:
  - `getInlineCompletionController(editor)`
  - `getAIInlineCompletionController(editor)`
  - `getAIInlineHistoryController(editor)`
  - `getAIReviewController(editor)`
- keep `getAIController(editor)` for compatibility

`packages/rendering/react/src/primitives/ai/root.tsx`

- no behavior changes required in Phase 1
- it may continue to read through the compatibility controller until Phase 2

##### Explicit non-goals for Phase 1

- no new package yet
- no `Tab` precedence changes yet
- no prompt-building changes
- no provider system yet
- no sequence segmentation changes yet

##### Phase 1 success criteria

- a dedicated inline-completion service exists behind its own slot
- a dedicated inline-history service exists behind its own slot
- a dedicated review service exists behind its own slot
- the compatibility `AIController` delegates to those services
- existing runtime behavior remains unchanged
- existing tests continue to describe the same user-visible behavior

### Phase 2: Move `Tab` Ownership Into `@pen/react`

Goal:

- centralize key precedence in the field editor

Work:

- remove autocomplete-style `Tab` acceptance from the global listener in `Pen.AI.Root`
- add field-editor integration points so the field editor can:
  - detect visible inline completion
  - accept visible inline completion
  - explicitly trigger autocomplete when none is visible
- preserve existing precedence:
  - table navigation
  - list indentation
  - inline completion accept
  - explicit autocomplete trigger
  - fallback

Primary files:

- `packages/rendering/react/src/field-editor/keyHandling.ts`
- `packages/rendering/react/src/primitives/editor/root.tsx`
- `packages/rendering/react/src/primitives/ai/root.tsx`
- `packages/types/src/types/fieldEditor.ts`
- `packages/types/src/constants/slots.ts`

Possible interface additions:

- an editor slot for the autocomplete controller
- a small helper in `@pen/react` to resolve the active autocomplete controller from editor slots

Design notes:

- the field editor should remain the single source of truth for text-editing key semantics
- explicit `Tab` trigger should only fire when the context is eligible
- `Shift+Tab` should continue to respect outdent behavior where applicable

Exit criteria:

- no global autocomplete `Tab` listener is needed for the production path
- table and list behavior remain unchanged
- acceptance and explicit trigger work through field-editor-owned precedence

### Phase 3: Create `@pen/ai-autocomplete`

Goal:

- add the dedicated inference and scheduling package

Work:

- create the package scaffold and public exports
- implement:
  - controller
  - scheduler
  - trigger policy
  - prompt builder
  - sequence normalization
  - metrics
  - diagnostics
- connect to:
  - editor commit events
  - selection changes
  - field-editor slot state
  - shared inline-completion primitive

Primary files to add:

- `packages/extensions/ai-autocomplete/src/index.ts`
- `packages/extensions/ai-autocomplete/src/extension.ts`
- `packages/extensions/ai-autocomplete/src/controller.ts`
- `packages/extensions/ai-autocomplete/src/scheduler.ts`
- `packages/extensions/ai-autocomplete/src/triggerPolicy.ts`
- `packages/extensions/ai-autocomplete/src/promptBuilder.ts`
- `packages/extensions/ai-autocomplete/src/sequence.ts`
- `packages/extensions/ai-autocomplete/src/metrics.ts`
- `packages/extensions/ai-autocomplete/src/diagnostics.ts`
- `packages/extensions/ai-autocomplete/src/types.ts`

Integration files to add:

- `packages/extensions/ai-autocomplete/src/integrations/inlineCompletion.ts`
- `packages/extensions/ai-autocomplete/src/integrations/fieldEditorState.ts`
- `packages/extensions/ai-autocomplete/src/integrations/localContext.ts`

Provider files to add:

- `packages/extensions/ai-autocomplete/src/providers/types.ts`
- `packages/extensions/ai-autocomplete/src/providers/registry.ts`
- `packages/extensions/ai-autocomplete/src/providers/builtins.ts`
- `packages/extensions/ai-autocomplete/src/providers/descriptors.ts`

Design notes:

- v1 prompt construction should come directly from editor/block APIs, not generic tools
- v1 providers should be sync or cache-backed by default
- model output should be normalized client-side into segments
- partial accept should optionally trigger continuation prefetch

Exit criteria:

- autocomplete can proactively appear while typing
- autocomplete can be explicitly triggered with `Tab`
- completion accept flows through `editor.apply(..., { origin: "ai" })`

### Phase 4: Integrate Provider Descriptors With `@pen/ai-skills`

Goal:

- expose the autocomplete context strategy to external agent workflows without putting skills on the hot path

Work:

- define descriptor shape for registered autocomplete providers
- extend skill rendering to optionally include autocomplete provider references
- keep provider descriptors informational, not executable

Primary files:

- `packages/extensions/ai-skills/src/index.ts`
- `packages/extensions/ai-skills/src/render.ts`
- `packages/extensions/ai-skills/src/registry/defaultSkills.ts`
- `packages/extensions/ai-skills/src/registry/skillRegistry.ts`

Design notes:

- this is a DX/export step, not a runtime dependency
- the autocomplete package should not depend on `@pen/ai-skills`

Exit criteria:

- consumers can render skill/reference artifacts describing their autocomplete provider context

### Phase 5: Playground, Tests, And Benchmarks

Goal:

- make the behavior visible, tunable, and measurable

Work:

- add a playground demo with:
  - enable/disable
  - debounce
  - full vs sequence accept
  - prefetch-after-accept
  - provider timing visibility
- add browser tests covering:
  - proactive typing
  - explicit `Tab` trigger
  - progressive `Tab` accept
  - IME suppression
  - external-edit invalidation
- add benchmark suites covering:
  - scheduler overhead
  - cancel churn
  - provider budgets
  - decoration refresh
  - partial accept
  - continuation prefetch

Primary files:

- `playground/src/App.tsx`
- `playground/src/App.css`
- `playground/src/components/PlaygroundEditorViewport.tsx`
- `packages/rendering/react/src/__tests__/aiPrimitives.test.tsx`
- `packages/tooling/bench/src/suites/extension.bench.ts`

Exit criteria:

- the feature is observable in the playground
- behavior is regression-tested
- performance characteristics are measurable

---

## Recommended Delivery Slices

If the team wants fast iteration without overbuilding, ship these slices in order:

### Slice 1: Mechanical Refactor

- extract shared inline-completion primitive
- preserve existing behavior
- no new package yet

### Slice 2: Correct `Tab` Ownership

- field editor owns `Tab`
- remove global autocomplete-style `Tab` interception
- still no proactive autocomplete yet

### Slice 3: Minimal Autocomplete v1

- new package
- proactive typing trigger
- explicit `Tab` trigger
- full-accept mode only
- local prompt context only
- no custom providers yet except built-ins

### Slice 4: Sequence Acceptance

- client-side segmentation
- repeated `Tab`
- partial-accept prefetch

### Slice 5: Optional Provider Descriptor Layer

- provider registration
- provider descriptors
- skill packaging
- playground diagnostics

This order reduces risk. It also gives a usable feature early without forcing the team to solve every extensibility concern up front.

---

## Risks And Mitigations

### Risk: Regressing Existing AI Inline Flows

Mitigation:

- extract the shared primitive first
- keep `@pen/ai` on top of the primitive before introducing the new package

### Risk: Breaking `Tab` Semantics

Mitigation:

- move behavior into `handleFieldEditorKeyDown()`
- keep table and list tests green before enabling explicit trigger

### Risk: Latency Regressions From Custom Context

Mitigation:

- default to sync/cache-backed providers
- hard-cap provider time and size budgets
- do not use the generic tool loop

### Risk: Stale Suggestion Flash

Mitigation:

- validate anchor and revision before showing a result
- discard stale results before render

### Risk: Overbuilding Sequence Semantics Too Early

Mitigation:

- ship full-accept first if needed
- layer sequence normalization and prefetch in a follow-up slice

---

## Open Questions

1. Should v1 support multiline tails everywhere, or should prose and code blocks use different default limits?
2. Should code blocks use a specialized segmentation policy?
3. Should the shared inline-completion primitive remain in `@pen/ai` or move into a smaller shared internal package after extraction?
4. Should prefetch-after-accept be enabled by default for all surfaces or only desktop-first surfaces?
5. Should provider descriptors become a first-class `@pen/ai-skills` registry concept, or remain optional metadata?
