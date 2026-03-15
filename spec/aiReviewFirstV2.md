# AI Architecture — Reviewable Mutation Infrastructure

**Status:** Proposed reset

**Related packages:** `@pen/ai`, `@pen/react`, `@pen/ai-tools`, `@pen/bench`

**Depends on:** Wave 6, Wave 7

---

## Goal

Define Pen's AI architecture around reviewable mutation infrastructure rather than chat-product scope.

After this reset:

- Pen AI is centered on safe document mutation
- reviewability, receipts, provenance, and grouped undo are first-class
- tool use remains an escalation path, not the default authored experience
- performance and developer experience remain part of the architecture contract
- `/web` and `/api` own workflow chrome, orchestration, and product analytics

---

## Core Principle

**The canonical output of Pen AI is a document mutation result that can be applied directly or resolved through review.**

That result may include:

- direct-apply mutations
- staged suggestions
- structured review items
- mutation receipts
- step metadata and provenance
- grouped undo and redo metadata

Pen should not center its AI architecture on sessions, chat surfaces, or visible modes.

---

## Why This Direction

Pen already has the right raw ingredients:

- CRDT-native mutation
- `DocumentOp[]` as a stable write contract
- structured target inspection
- extension-owned suggest mode
- reviewable suggestions
- structured mutation plans
- tool runtime integration

The previous spec direction became too broad because it mixed those foundations with product-layer ideas such as:

- chat shells
- mode systems
- planning products
- orchestration UX
- broader agent-platform ambitions

The reset keeps the valuable foundations and removes the product gravity.

---

## Selective Foundations To Borrow

Pen should selectively borrow strong foundations from `vscode-copilot-chat` where they strengthen infrastructure:

- predictable undo and redo grouping around AI turns
- explicit step metadata
- clear execution provenance
- diagnostics vocabulary that developers can inspect quickly

Pen should not copy wholesale:

- the chat shell
- a mode-heavy UX model
- product workflow chrome
- agent personas as a core architecture concern

---

## Boundary

### Pen core and extension scope

Pen should own:

- document-aware AI routing
- mutation planning and execution bridges
- direct apply vs staged review decisions
- suggestion and structured-review infrastructure
- review entry derivation
- receipts, provenance, and grouped undo metadata
- tool escalation hooks
- headless review-oriented primitives where they are truly infrastructural
- route, validity, and performance diagnostics

### Consumer and ecosystem scope

Consumers and higher-level packages should own:

- chat shells
- prompt composers
- visible mode systems
- planning UX
- workflow orchestration
- product analytics and funnels
- opinionated task or agent experiences

---

## Canonical AI Model

### 1. Request

A consumer issues an AI-assisted edit request against a document, selection, block, or other structured target.

### 2. Route

Pen selects the lightest correct path:

- direct mutation
- staged suggestions
- staged structured review
- tool-backed escalation when document-native mutation is insufficient

### 3. Execute

Pen executes through the existing editor and tool seams:

- `StructuredTargetDescriptor`
- `DocumentMutationPlan`
- `ToolRuntime`
- `PenTransport`
- `editor.apply()`

### 4. Record

Every turn should produce enough evidence to understand what happened:

- receipt
- provenance
- undo group
- validation issues
- review entry when review is required

### 5. Resolve

Consumers then choose how to surface:

- direct success
- accept or reject review
- retry
- deeper workflow UX outside Pen core

---

## Architecture Priorities

### Priority 1: Reviewable mutation

Pen should make reviewable document change a first-class infrastructure concept.

### Priority 2: Trust and evidence

Receipts, provenance, and validation signals should be easy to inspect and easy to use in downstream tooling.

### Priority 3: Undo and redo integrity

AI turns should behave like coherent logical edits, not as a stream of unrelated low-level changes.

### Priority 4: Performance and DX

Review derivation, preview derivation, routing, and instrumentation must stay cheap enough for everyday development use.

### Priority 5: Controlled escalation

Tool use is valuable, but Pen should not default to a tool-first architecture when document-native paths are sufficient.

---

## Non-Goals

- Pen does not need to ship a chat product.
- Pen does not need public `Ask`, `Plan`, or `Agent` modes as architecture drivers.
- Pen does not need a standalone planning workflow architecture unless core runtime needs clearly justify it.
- Pen does not need product analytics in core packages.
- Pen does not need branch-first AI workflows in the main path.

---

## Relationship To Wave 7

Wave 7 should be interpreted as the implementation wave for AI mutation infrastructure:

- routing
- suggestions
- structured review
- receipts
- provenance
- grouped undo and redo behavior
- review primitives

That wave should be narrower than a full AI product shell.

---

## Success Criteria

This architecture is successful when:

- consumers can build AI editing experiences without reimplementing mutation trust infrastructure
- AI turns are easy to undo and inspect
- review flows are fast and coherent
- route quality and invalid/noop outcomes are measurable
- tool escalation remains purposeful
- `/web` and `/api` can build their own experiences without fighting Pen's assumptions

---

## Follow-on Specs

This architecture should primarily flow into:

1. `wave07AiTrackChanges.md`
2. `wave07bAiReviewInfrastructure.md`

Route quality, undo integrity, and performance diagnostics should live inside those implementation waves rather than in a separate planning or analytics spec.

A separate planning wave should not exist unless a later runtime need makes it unavoidable.
