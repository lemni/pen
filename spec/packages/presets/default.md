# @pen/preset-default

## Purpose

Default batteries-included editor preset for Pen

## Public Role

Package the standard runtime stack for most adopters so they can start from a coherent default.

## Key Exports / Entrypoints

- Export map: `.`
- Root export: `defaultPreset()`
- Workspace scripts: `build`, `clean`, `test`, `typecheck`

## Dependencies And Boundaries

- Runtime dependencies: `@pen/delta-stream`, `@pen/document-ops`, `@pen/shortcuts`, `@pen/types`, `@pen/undo`
- Peer dependencies: No peer dependencies declared.
- Boundary: Presets compose existing runtime packages rather than becoming new architecture layers.

## Data Flow / Runtime Model

Preset composition packages in Pen should stay package-first and explicit about ownership. Use `defaultPreset()` when the standard Pen runtime is the right baseline.

The default preset composes document tools, delta stream, undo, and rich-text shortcuts. Hosts can turn individual defaults off or pass typed options to the composed extension packages; hosts that need full control should skip the preset and register extensions explicitly through `createEditor({ extensions: [...] })`.

## Integration Notes

- Path in workspace: `packages/presets/default`
- Spec path mirrors workspace path: `packages/presets/default.md`
- This package is part of the current package surface and should stay aligned with the headless runtime architecture.
- Prefer `createEditor({ preset: defaultPreset(...) })` over the deprecated `createEditor({ without })` shape when customizing default feature composition.

## Current Maturity / Intended Usage

Workspace package at version `0.0.0`; intended usage is current-state but still evolving.

## Non-goals

Do not treat presets as a replacement for explicit extension composition when hosts need custom policy.
