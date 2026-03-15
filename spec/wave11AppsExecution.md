# Wave 11 — Optional Ecosystem Extensions

**Status:** Deferred / experimental

**Packages:** potential ecosystem packages such as `@pen/apps`, `@pen/execution`, `@pen/branch`

**Depends on:** stable core editor and AI mutation infrastructure

---

## Goal

Describe feature areas that may become useful ecosystem extensions later without letting them reshape Pen's core architecture today.

This document intentionally removes these areas from the main architecture spine.

---

## Why This Wave Is Deferred

Pen's core architecture should currently optimize for:

- editor correctness
- mutation safety
- reviewable AI changes
- speed and predictable performance
- great developer experience

Apps, local execution, skill-running shells, and branching may all be valuable, but they are not required to make Pen excellent at its primary job.

Treating them as core milestone drivers too early would distort the architecture around platform ambitions rather than editor infrastructure.

---

## Candidate Ecosystem Areas

### App embedding

Rich embedded apps may eventually be useful as downstream extensions.

If pursued, they should:

- build on the existing block and extension model
- respect document profile and schema boundaries
- avoid introducing a second mutation authority
- stay decoupled from Pen's core AI architecture

### Execution tools

Code execution, shell access, and file-system tools are not part of Pen's minimum architecture.

If pursued, they should:

- remain optional
- live behind explicit permissions and policy boundaries
- be treated as tool escalation infrastructure, not as the default editing path
- avoid redefining the editor as a general-purpose agent runtime

### Branching

Branch-backed workflows may be interesting, but they are not currently part of the main Pen path.

If pursued, they should:

- remain clearly experimental
- build on the CRDT and mutation model rather than bypassing it
- justify themselves against staged review and grouped undo before becoming mainstream

---

## Architecture Rules

Any future ecosystem extension in this area must preserve the following invariants:

1. `editor.apply()` remains the mutation authority.
2. `DocumentOp[]` remains the durable mutation currency.
3. Core editor hot paths do not absorb platform-specific overhead.
4. Product workflow chrome stays outside the architectural center.
5. Optional extensions do not force Pen to behave like a coding-agent shell.

---

## Non-Goals

This document does not commit Pen to shipping:

- a shell execution platform
- a built-in app marketplace
- runtime skill registries as a core concern
- branch-first AI workflows
- product UX for these areas

---

## Re-entry Criteria

These areas should only return to the main roadmap if at least one of the following becomes true:

- a core Pen use case cannot be served well by the existing editor and review infrastructure
- the runtime seams are already stable enough that the extension can stay cleanly isolated
- the feature improves Pen's editor-native value without dragging it into product-shell scope

---

## Key Decision

**Wave 11 is parked on purpose.** These ideas may become valuable ecosystem extensions later, but they should not currently drive Pen's architecture.
