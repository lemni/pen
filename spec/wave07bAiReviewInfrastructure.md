# Wave 7B — AI Review Infrastructure

**Milestone:** M1.1 · **Packages:** `@pen/ai`, `@pen/react`, `@pen/bench` · **Depends on:** Wave 7

---

## Goal

Turn Wave 7's AI substrate into a fast, trustworthy review infrastructure layer for editor-native AI mutation.

After this wave:

- every AI turn can expose a canonical review entry model
- suggestion-backed and structured-review-backed changes can be unified through shared contracts
- mutation receipts become first-class trust evidence
- turn-level resolution semantics are formalized in core infrastructure
- review resolution becomes a coherent undoable action rather than UI-only state
- review derivation and rendering paths stay measurable and benchmarked

This wave improves editor-native review infrastructure. It does not introduce a built-in chat shell, workflow chrome, or end-user review product.

---

## Why This Wave Exists

Wave 7 correctly built:

- session turns
- persistent suggestions
- structured preview
- review items
- accept/reject semantics
- mutation receipts

Those pieces now need consolidation at the infrastructure layer.

Without this wave, Pen still leaves too much interpretation to each consumer:

- suggestions and structured review use different internal shapes
- receipts are mostly debug-facing
- turn resolution semantics are not explicit enough
- review-oriented primitives do not yet define a stable integration contract for `/web`

This wave makes reviewed AI change the primary editor-native abstraction, while keeping product workflow ownership outside Pen core.

---

## Infrastructure Principle

**The canonical output of Pen AI is a reviewable change set attached to an AI turn.**

A turn may be backed by:

- persistent suggestions
- structured review items
- both

Consumers should be able to build one review experience without needing to care which lower-level mechanism produced the turn's reviewable changes.

---

## Scope

### In scope

- unified review entry model
- turn-level review lifecycle
- review grouping and summarization contracts
- structured preview clarity improvements
- mutation receipt promotion
- undo and redo integrity for review resolution
- review-oriented headless primitives
- review-infrastructure metrics and benchmarks

### Out of scope

- built-in review workflow chrome
- built-in chat or dock UIs
- public `Ask` or public `Agent` modes
- org instruction systems
- branch-backed AI workflows
- app-level session persistence and orchestration

---

## Required File Areas

```text
packages/extensions/ai/src/
├── extension.ts
├── types.ts
├── runtime/
│   ├── structuredPlanner.ts
│   ├── planExecutor.ts
│   ├── reviewArtifacts.ts
│   ├── mutationReceipt.ts
│   └── router.ts
└── suggestions/
    └── *

packages/rendering/react/src/
├── primitives/ai/
│   ├── changeList.tsx
│   ├── structuredTargetPreview.tsx
│   ├── inlineSession.tsx
│   └── *
└── hooks/
    └── *

packages/tooling/bench/src/
└── suites/
```

Playground changes are optional development harness work, not part of the core wave contract.

No cycles.

---

## Review Model

### Canonical unit: review entry

Each AI turn produces zero or one canonical review entry.

A review entry is the infrastructure-level representation of all pending changes for that turn.

A review entry may aggregate:

- persistent suggestion ids
- structural review item ids
- receipt metadata
- summarized counts of added/removed/updated/moved changes

### Turn resolution status

Turn status remains session-oriented, but review status becomes explicit:

- `pending`
- `accepted`
- `rejected`
- `partially-resolved`

A turn may still have underlying internal statuses such as `streaming` or `error`, but once generation completes the review entry becomes the primary review-resolution object.

---

## Types

### `types.ts`

```typescript
export interface AIReviewEntry {
  id: string;
  sessionId: string;
  turnId: string;
  kind: 'suggestions' | 'structured-plan' | 'mixed';
  status: 'pending' | 'accepted' | 'rejected' | 'partially-resolved';
  suggestionIds: string[];
  reviewItemIds: string[];
  receipt?: AIMutationReceipt | null;
  undoGroupId?: string | null;
  summary: {
    added: number;
    removed: number;
    updated: number;
    moved: number;
  };
}

export interface AIReviewResolutionResult {
  entryId: string;
  resolution: 'accept' | 'reject';
  fullyResolved: boolean;
  remainingSuggestionIds: string[];
  remainingReviewItemIds: string[];
}
```

### Design rules

- review entries are derived from canonical turn state; they are not an independent source of truth
- a turn may have at most one active review entry
- a review entry survives until all pending changes for that turn are resolved or invalidated
- receipt metadata is attached whenever available, even for invalid or noop outcomes
- resolution metadata should stay traceable to the logical undo group for that turn

---

## Headless Review Primitives

### `Pen.AI.ChangeList` attributes

`Pen.AI.ChangeList` is a headless review primitive that consumers may use to render completed AI turns.

It must support:

- suggestions-only turns
- structured-review-only turns
- mixed turns

The primitive should expose enough state to present:

- high-level summary
- grouped changes
- per-group actions
- per-item actions
- turn-level accept/reject actions
- attached receipt and route evidence

### Infrastructure behavior

- consumers can resolve the entire turn from one place if they choose
- consumers can inspect grouped changes before resolving
- structured preview and change list use compatible grouping language
- mixed turns do not require separate review data models

---

## Mutation Receipts

### Infrastructure role

`AIMutationReceipt` is promoted from debug evidence to trust evidence exposed through Pen infrastructure.

Each receipt should communicate:

- `status`
- affected block count
- created block count
- route lane
- mutation mode
- apply strategy
- target kind
- validation issues when present

### Receipt statuses

Existing receipt statuses continue:

- `applied`
- `staged_review`
- `staged_suggestions`
- `noop`
- `invalid`
- `error`

### Receipt semantics

- `invalid` and `error` must be visible and explainable
- `noop` must be distinguishable from "success with no visible change"
- `staged_review` and `staged_suggestions` should clearly explain why review is required
- direct apply should still carry evidence about route and strategy

---

## Structured Preview

### Preview goal

Make structured preview understandable before resolution.

### Required improvements

Structured preview must expose:

- what target is being changed
- what kinds of changes are proposed
- what is still draft vs validated
- what review items will exist if accepted into staged review
- what assumptions or validation issues remain

### Preview states

- `drafted`
- `validated`
- `rejected`

`drafted` and `validated` should remain distinguishable in exposed state and headless primitives. Consumers may choose how to render that distinction.

---

## Turn Resolution Semantics

### Turn-level resolution

Every completed turn with pending changes must support:

- `accept turn`
- `reject turn`

These actions resolve:

- all suggestion ids attached to the turn
- all review item ids attached to the turn

### Resolution is a history action

Review resolution is not one thing. Pen must distinguish mutating resolution from non-mutating local review state.

When a resolution mutates document state, it must:

- flow through `editor.apply()`
- use a tracked undo origin
- create or join a coherent logical undo group for that review action
- remain inspectable through receipt and provenance metadata

When a resolution does not mutate document state, it must:

- remain local controller or UI state
- avoid creating synthetic document-history entries
- avoid shadowing document undo or redo shortcuts

This is especially important for suggestion-backed review, where accept and reject must not fall out of document history simply because they are "resolution" actions, and for structured-review rejection, which may be a purely local dismissal rather than a document mutation.

### Partial resolution

If a consumer resolves individual items first:

- turn-level status becomes `partially-resolved`
- remaining pending ids stay attached
- a later turn-level resolution only affects remaining ids

### Finalization

A turn is fully resolved when:

- no pending suggestion ids remain
- no pending review item ids remain

At that point:

- review entry status becomes `accepted` or `rejected`
- session-level pending ids are recomputed
- inline edit surfaces may close according to existing session semantics if the consumer uses those primitives

### UI history vs document history

Consumers may keep lightweight local UI history for inline prompts or local review chrome, but:

- document undo and redo remain authoritative for document mutations
- local UI restoration must not replace or shadow document history for accepted or rejected changes
- keyboard shortcuts should prefer document history unless the operation is strictly local and non-mutating
- accepted review chrome does not need to be reconstructible from undo or redo unless it corresponds to still-pending document-backed review state

---

## UI Data Attributes

Review primitives remain headless and unstyled.

### `Pen.AI.ChangeList`

Required attributes:

- `[data-pen-ai-change-list]`
- `[data-review-entry-count]`
- `[data-has-pending-review]`
- `[data-has-structured-review]`
- `[data-has-suggestion-review]`

### Review entry root

Required attributes:

- `[data-review-entry-id]`
- `[data-review-entry-kind]`
- `[data-review-entry-status]`
- `[data-review-turn-id]`
- `[data-review-session-id]`

### Receipt container

Required attributes:

- `[data-pen-ai-receipt]`
- `[data-receipt-status]`
- `[data-route-lane]`
- `[data-apply-strategy]`

---

## Performance And DX Requirements

This wave must optimize for:

- low-overhead derivation of review entries
- predictable render costs for large staged outputs
- stable integration contracts for `/web`
- easy-to-debug receipts and resolution state

The design should prefer:

- simple derived state over duplicated state
- explicit status transitions over inferred UI heuristics
- stable type contracts over product-specific abstractions
- one coherent undo model over separate special-case review history paths

---

## Metrics

This wave must emit metrics suitable for infrastructure diagnostics and integration-level evaluation.

### Required metrics

- review entry count by kind
- resolution outcome count by kind
- resolution failure rate
- undo group mismatch rate for review resolution
- review undo replay failure rate
- invalid receipt rate
- noop receipt rate
- accept/reject ratio by lane
- accept/reject ratio by apply strategy

### Minimum metric dimensions

- route lane
- mutation mode
- apply strategy
- target kind
- review entry kind

---

## Benchmarks

This wave adds bench coverage for review-infrastructure performance.

### Required benches

- review entry aggregation latency
- render large change list with many suggestion items
- render structured review groups with many items
- recompute review entry summaries under resolution churn
- accept and reject review actions under undo and redo replay
- structured preview diff/summary generation latency

Benchmarks should ensure review infrastructure does not regress editor responsiveness on large staged outputs.

---

## Acceptance Criteria

1. Every completed AI turn with pending changes can expose a single canonical review entry.
2. Pen review contracts and primitives can represent suggestions-only, structured-only, and mixed turns.
3. Pen exposes turn-level accept and reject resolution for all pending changes on a turn.
4. Pen still supports individual review group and item resolution where applicable.
5. Partial resolution is represented explicitly and session pending state updates correctly.
6. Structured preview clearly distinguishes drafted vs validated plans in exposed state.
7. Mutating review resolution remains coherent under undo and redo, while non-mutating review dismissal stays out of document history.
8. Mutation receipts are available through Pen infrastructure and attached to turn review state.
9. Invalid and noop outcomes are explicitly represented rather than silently collapsing into generic completion.
10. Review metrics are emitted with route lane, mutation mode, apply strategy, target kind, review entry kind, and review-resolution undo dimensions.
11. Bench coverage exists for large review surfaces, structured review grouping, and review-resolution replay.
12. Review primitives remain headless and expose `data-*` attributes for styling and testing.
13. This wave does not introduce a broad public multi-mode AI shell.

---

## Key Decisions

1. **Review entry is the infrastructure abstraction.** Suggestions and structured items remain technical mechanisms underneath it.
2. **Turn resolution is the primary infrastructure workflow.** Individual item resolution remains available but secondary.
3. **Receipts are trust evidence.** They are not only debug payloads.
4. **Structured preview is part of review, not separate from it.**
5. **Mixed turns are normal.** Pen must not fragment them into separate underlying models.
6. **Undo integrity is part of review correctness.** Mutating review resolution must remain in document history, and non-mutating review state must not compete with it.
7. **Speed and DX matter.** Review infrastructure that is hard to integrate or slow to derive is not acceptable.

---

## Follow-on

After this wave, Pen may refine provenance and undo-group evidence inside the main AI mutation infrastructure, but should avoid expanding into a built-in planning shell.
