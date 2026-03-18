# `@pen/schema-default`

Default block and inline schemas for Pen.

## Install

```bash
pnpm add @pen/core @pen/schema-default
```

## What It Provides

- `defaultSchema` for the standard shipped schema
- `createDefaultSchema()` when you want a fresh schema instance
- `defaultBlocks` and `defaultInlines` for lower-level composition
- direct exports for common blocks such as `paragraph`, `heading`, `table`, and `database`

## Minimal Setup

```ts
import { createEditor } from "@pen/core";
import { createDefaultSchema } from "@pen/schema-default";

const editor = createEditor({
  schema: createDefaultSchema(),
});
```

## Shipped Surface

The default schema includes common rich-text building blocks such as:

- paragraphs and headings
- bullet, numbered, and checklist items
- code blocks and images
- tables and databases
- dividers, callouts, toggles, and blockquotes
- marks and inline nodes such as bold, italic, links, mentions, and inline apps

## Integration Notes

- Use `defaultSchema` when you want the repository's standard document model as-is.
- Use `createDefaultSchema()` when you want to merge in custom blocks or inline definitions.
- Schema definitions describe document structure and behavior, not product-specific UI.
