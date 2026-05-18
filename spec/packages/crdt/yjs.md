# @pen/crdt-yjs

## Purpose

Yjs CRDT adapter for Pen

## Public Role

Bridge Pen contracts to a specific CRDT implementation.

## Key Exports / Entrypoints

- Export map: `.`
- CRDT adapter and document helpers such as `yjsAdapter()`, `wrapYjsDocument()`, `initBlockMap()`, and `getYjsDoc()`
- Collaboration helpers such as `createYjsProviderSession()`, `createYjsAwareness()`, and `getYjsAwareness()`
- State-vector helpers such as `encodeYjsStateVectorBase64()`, `compareYjsStateVectors()`, and `isYjsStateVectorBase64Satisfied()`
- Generic field adapters such as `createYTextFieldAdapter()` and `createYArrayFieldAdapter()`
- Extension-root helpers such as `ensureExtensionRoot()` and `readExtensionRoot()`
- Workspace scripts: `build`, `clean`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@pen/types`, `y-protocols`, `yjs`
- Peer dependencies: No peer dependencies declared.
- Boundary: Adapters must respect the editor authority boundary while exposing persistence and sync integration points.

## Data Flow / Runtime Model

CRDT adapter packages in Pen should stay package-first and explicit about ownership. Use this package when a host app adopts the matching CRDT backend.

State-vector helpers are the generic synchronization primitive for host-owned workflow barriers. A host can capture a Yjs state vector before enqueueing work and later ask whether a synced document satisfies that barrier without duplicating Yjs clock comparison logic.

Field adapters cover host-owned non-body fields that live next to Pen document roots, such as titles, labels, tags, or app-specific structured arrays. They are storage helpers only: hosts provide normalization and stable IDs, while Pen provides deterministic Yjs text/array operations.

Extension-root helpers reserve namespaced Yjs maps under the document `apps` root. They provide version checks and deterministic field initialization for app-owned collaboration data without teaching Pen product-specific schema.

## Integration Notes

- Path in workspace: `packages/crdt/yjs`
- Spec path mirrors workspace path: `packages/crdt/yjs.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.
- Keep app semantics out of the adapters. For example, a recipient list should be implemented as a host-specific array adapter configuration, not as an email-aware Pen primitive.
- Prefer extension roots over ad hoc top-level shared types for new app-owned CRDT data.

## Current Maturity / Intended Usage

Workspace package at version `0.0.0`; intended usage is current-state but still evolving.

## Non-goals

- Do not let the adapter redefine the Pen document model or renderer behavior.
- Do not make Durable Streams, WebSocket providers, or app-owned sync state part of this package.
- Do not encode product-specific validation in field adapters.
