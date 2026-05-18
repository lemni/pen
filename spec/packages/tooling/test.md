# @pen/test

## Purpose

Headless testing utilities for Pen

## Public Role

Support development, testing, benchmarking, or local integration workflows around Pen.

## Key Exports / Entrypoints

- Export map: `.`
- Workspace scripts: `build`, `clean`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@pen/core`, `@pen/crdt-yjs`, `@pen/export-json`, `@pen/schema-default`, `@pen/types`, `yjs`
- Peer dependencies: No peer dependencies declared.
- Boundary: Tooling packages serve the workspace and advanced integrators more than standard runtime embedding.

## Data Flow / Runtime Model

Tooling packages in Pen should stay package-first and explicit about ownership. Use these packages in development flows, tests, or benchmarks.

`@pen/test` provides deterministic Yjs fixtures and opt-in contract helpers for host apps and Pen packages. Fixture helpers generate stable updates, state vectors, and normalized snapshots without relying on product data. Contract helpers exercise CRDT state-vector satisfaction, headless editor creation, and export behavior while leaving the choice of test runner to the host.

## Integration Notes

- Path in workspace: `packages/tooling/test`
- Spec path mirrors workspace path: `packages/tooling/test.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.
- Use `createDeterministicYDocFixture()` when a test needs a stable Yjs update or normalized root snapshot.
- Use `runCRDTStateVectorContract()`, `runHeadlessEditorContract()`, and `runExportContract()` as opt-in smoke contracts for host integrations.

## Current Maturity / Intended Usage

Workspace package at version `0.0.0`; intended usage is current-state but still evolving.

## Non-goals

- Do not present tooling packages as the editor runtime itself.
- Do not encode host-product fixture data in Pen test helpers.
- Do not require host apps to use Pen's test runner.
