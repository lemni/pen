# Wave 7 — AI Mutation Infrastructure

**Milestone:** M1 · **Packages:** `@pen/ai`, `@pen/react` · **Depends on:** M0 (Waves 0-6)

---

## Goal

Ship the AI extension layer that turns model output into fast, reviewable, document-safe mutation.

After this wave:

- Pen can route AI requests into direct apply or staged review paths
- persistent suggestions and structured review share common turn-level metadata
- every AI turn produces receipts, provenance, and grouped undo metadata
- tool-backed execution remains available as escalation
- review-oriented primitives stay headless and composable

This wave defines AI mutation infrastructure. It does not define a built-in chat shell, product workflow, or mode system.

---

## Scope

### In scope

- AI extension runtime
- route selection for editor-native mutation
- suggestion and structured review infrastructure
- structured preview and mutation-plan execution bridges
- mutation receipts and execution provenance
- grouped undo and redo semantics for AI turns
- headless review-oriented React primitives
- diagnostics and benchmark hooks for hot paths

### Out of scope

- chat shells and dock layouts
- command-menu product UX as an architecture requirement
- public `Ask`, `Plan`, or `Agent` modes
- planning workflow productization
- product funnel analytics
- branch-first AI flows

---

## Required File Areas

```text
packages/extensions/ai/src/
├── extension.ts
├── types.ts
├── runtime/
│   ├── router.ts
│   ├── structuredPlanner.ts
│   ├── planExecutor.ts
│   ├── reviewArtifacts.ts
│   ├── mutationReceipt.ts
│   └── *
└── suggestions/
    └── *

packages/rendering/react/src/
├── primitives/ai/
│   ├── changeList.tsx
│   ├── structuredTargetPreview.tsx
│   ├── inlineSuggestionControls.tsx
│   └── *
└── hooks/
    └── *

packages/tooling/bench/src/
└── suites/
```

No cycles.

---

## Infrastructure Principle

**Pen AI should produce the lightest correct mutation path for the current target.**

That path may be:

- direct apply
- staged suggestions
- staged structured review
- tool-backed execution when document-native mutation is insufficient

The architecture should optimize for correct mutation and trustworthy review, not for maximizing visible AI surface area.

---

## Canonical AI Turn

Each AI turn should capture:

- the target and route lane
- the resulting mutation mode
- receipt and validation information
- provenance and step metadata
- the undo group identifier
- review entry linkage when review is required

The AI turn is the execution boundary. Product-layer sessions and shells may group turns later, but they are not required by this wave.

---

## Mutation Modes

This wave should support three main mutation outcomes:

### Direct apply

Use when confidence and target suitability are high enough that immediate mutation is appropriate.

### Staged suggestions

Use when text-level review is needed and suggest-mode interception provides the best fit.

### Staged structured review

Use when the target or proposed edits need explicit grouped review beyond inline suggestion marks.

Tool-backed execution may feed any of those outcomes, but should not replace them.

---

## Core Contracts

### Turn metadata

`types.ts` should expose turn-level metadata rich enough to connect:

- request
- route
- execution
- review
- undo
- diagnostics

### Receipts

Each turn should emit an `AIMutationReceipt` that describes:

- status
- route lane
- mutation mode
- apply strategy
- target kind
- affected and created block counts
- validation issues when present

### Review linkage

If review is required, the turn must link to the pending suggestions or structured review items that the consumer may resolve later.

### Provenance

The AI layer should retain enough provenance to explain:

- which path ran
- which steps occurred
- whether tools were invoked
- how the final mutation result was produced

---

## Grouped Undo And Redo

This wave should deliberately borrow one of the strongest foundations from `vscode-copilot-chat`: coherent undo and redo grouping around AI turns.

### Requirements

- each turn should map to one logical undo group unless explicitly split by policy
- direct apply mutations should undo coherently as one turn result
- staged apply flows should preserve enough metadata to undo accepted changes coherently
- undo and redo metadata should remain inspectable in development diagnostics

Undo grouping is an infrastructure requirement, not UI polish.

---

## Structured Planning And Preview

Pen may still use:

- structured target inspection
- structured intent compilation
- document mutation plans
- structured preview

But those remain implementation tools inside the AI mutation layer.

This wave does not create a separate planning product architecture. Any plan-like state should stay subordinate to mutation and review.

---

## Tool Escalation

Tool-backed execution is supported, but only as escalation.

### Design rules

- attempt document-native mutation first when feasible
- keep tool use visible in provenance and receipts
- require readable summaries of tool-backed work
- normalize the final result back into direct apply or reviewable mutation whenever possible

---

## Headless React Primitives

This wave may expose review-oriented and preview-oriented primitives in `@pen/react`, but only where they represent stable infrastructure.

Examples:

- change lists
- structured target previews
- inline suggestion controls

This wave does not require:

- a built-in chat dock
- a built-in command composer
- a prescribed AI shell layout

---

## Performance And DX Requirements

This wave must optimize for:

- low-latency route selection
- bounded context reads
- cheap review-entry and preview derivation
- minimal instrumentation overhead on hot paths
- clear receipts and provenance for debugging

The design should prefer:

- reusing `DocumentState`, structured targets, and existing write pipelines
- deriving review state from turn state rather than duplicating heavy state
- keeping UI-facing concepts out of runtime contracts

---

## Acceptance Criteria

1. Pen can route an AI-assisted edit into direct apply, staged suggestions, or staged structured review.
2. Every completed AI turn emits enough metadata to explain route, mutation mode, receipt, provenance, and undo grouping.
3. Direct apply and staged flows both preserve coherent undo and redo behavior.
4. Reviewable outcomes can link to pending suggestions or structured review items without requiring a built-in chat shell.
5. Tool escalation remains secondary to document-native mutation and is reflected in turn provenance.
6. Headless review and preview primitives remain composable and unstyled.
7. Diagnostics and benchmarks can measure route, receipt, review derivation, and instrumentation overhead.
8. This wave does not introduce product-layer mode systems or workflow chrome as core requirements.

---

## Key Decisions

1. **AI in Pen is a mutation system first.** Not a chat product.
2. **Turn metadata matters.** Receipts, provenance, and undo groups are part of the contract.
3. **Review and direct apply are peers.** The router chooses the lightest correct path.
4. **Structured planning stays subordinate.** It supports mutation; it is not its own product architecture.
5. **Performance and DX are non-negotiable.** Hot-path overhead is architecture work, not later polish.

---

## Follow-on

Wave 7B should deepen review infrastructure and headless review primitives.

Route quality, receipt, review, and instrumentation diagnostics should be specified directly in Wave 7 and Wave 7B rather than in a separate analytics spec.
