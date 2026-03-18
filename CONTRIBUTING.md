# Contributing To Pen

Thanks for your interest in improving Pen.

Pen is a source-available SDK published as public npm packages. Contributions to the
repository are welcome, but production use of the SDK is governed by the Pen license in
`LICENSE.md`.

## Local Setup

```bash
pnpm install
pnpm lint
pnpm build
pnpm typecheck
pnpm test
```

If you are working on browser flows in the playground, run the end-to-end suite with:

```bash
pnpm test:e2e
```

## Repository Shape

- `packages/core` owns editor authority, document state, normalization, and the canonical mutation path.
- `packages/types` owns shared contracts and lightweight helpers.
- `packages/rendering/*` bind the headless runtime to framework-specific surfaces.
- `packages/extensions/*` add optional runtime behavior such as AI, search, import/export, and collaboration.
- `packages/docs` and `playground` are workspace apps used to document and exercise shipped surfaces.

## Engineering Expectations

- Keep Pen headless and extension-first. Avoid pushing product-specific UI opinions into shared runtime packages.
- Route durable document writes through `editor.apply(ops, options)`.
- Respect package boundaries. Renderer packages should not become alternate sources of document truth.
- Prefer small, focused pull requests over broad refactors.
- Update docs or README examples when you change a public surface or onboarding path.

## Pull Request Checklist

- Add or update tests when behavior changes.
- Run the relevant local validation commands before opening a PR.
- Call out user-facing API, package, or docs changes in the PR description.
- Link related issues or context when available.

## Questions And Support

See `SUPPORT.md` for where to ask questions, report bugs, or raise licensing concerns.
