# Wave 6 — AI Tool Packages And Benchmarks

**Milestone:** M0 · **Packages:** `@pen/ai-tools`, `@pen/ai-skills`, `@pen/bench` · **Depends on:** Waves 0-5

---

## Goal

Ship the package-first AI integration seams for Pen without turning Pen core into an agent platform.

After this wave:

- Pen exposes a canonical native tool surface through `@pen/ai-tools`
- optional skill artifacts can be generated through `@pen/ai-skills`
- benchmark coverage remains part of the M0 release bar

This wave is about package boundaries and execution seams. It does not define chat products, protocol bridges, or runtime skill platforms.

---

## Scope

### In scope

- `@pen/ai-tools` as the public package for editor-attached tool execution
- `@pen/ai-skills` as an optional artifact/distribution package
- benchmark coverage for tool execution and integration hot paths

### Out of scope

- runtime skill registries as a core architecture concern
- protocol bridge ownership
- agent personas or task shells
- product-specific orchestration
- code-execution platforms

---

## Package 1: `@pen/ai-tools`

`@pen/ai-tools` is the public AI/tool package that sits on top of the editor-attached `ToolRuntime`.

### Skill artifact responsibilities

- resolve the active tool runtime from a Pen editor
- list tool descriptors for hosted model runtimes
- execute tools and normalize buffered output
- re-export advanced helpers where hosted execution needs them

### Skill artifact design rules

- reuse `@pen/document-ops` and `@pen/content-ops` for document semantics
- do not duplicate mutation logic in `@pen/ai-tools`
- keep the package environment-agnostic and transport-friendly

---

## Package 2: `@pen/ai-skills`

`@pen/ai-skills` is an optional artifact package that repackages the same native tool surface for external agent ecosystems.

### Responsibilities

- define skill metadata
- render `SKILL.md`-style artifacts
- attach helper references when useful
- treat `@pen/ai-tools` as the execution source of truth

### Design rules

- skills are distribution artifacts, not a runtime execution engine
- skill instructions should point back to the canonical native tool surface
- the package should remain simple enough to embed into external install flows

---

## Package 3: `@pen/bench`

Tooling and AI integration benchmarks remain part of the M0 quality bar.

### Required benchmark areas

- native tool listing latency
- tool execution overhead
- buffered tool output memory and latency behavior
- instrumentation overhead on hot paths

---

## Acceptance Criteria

1. `@pen/ai-tools` exists and is the documented public tool package.
2. `@pen/ai-skills` exists as an optional artifact package and can render real skill artifacts from tool descriptors.
3. Benchmarks remain part of the release bar for AI integration paths.
4. This wave does not redefine editor authority, chat UX, or runtime workflow ownership.

---

## Key Decisions

1. **Tools are first-class; agent shells are not.**
2. **`@pen/ai-tools` is canonical.** Skill packaging is downstream.
3. **Benchmarks are part of architecture quality.** AI integration should stay measurable from the start.
