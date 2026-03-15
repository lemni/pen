# `@pen/input-rules`

Opt-in markdown autoformat for Pen.

This package is intentionally **not** included in `defaultPreset()`. Library users enable it only when they want markdown-style typing shortcuts.

## Install

```bash
pnpm add @pen/input-rules
```

## Usage

```ts
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { inputRulesExtension } from "@pen/input-rules";

const editor = createEditor({
  preset: defaultPreset(),
  extensions: [inputRulesExtension()],
});
```

Without the extension:

```ts
const editor = createEditor({
  preset: defaultPreset(),
});
```

markdown autoformat remains disabled.

## What it adds

Block shortcuts:

- `# ` through `###### ` -> headings
- `- `, `* `, `+ ` -> bullet list
- `1. ` -> numbered list
- `[ ] `, `[x] ` -> checklist
- `> ` -> blockquote
- `` ``` `` -> code block
- `---`, `***`, `___` -> divider
- `> [!note] ` -> callout

Inline shortcuts:

- `**text**` -> bold
- `*text*` -> italic
- `` `text` `` -> code
- `~~text~~` -> strikethrough
- `==text==` -> highlight

## Notes

- This package is headless and renderer-agnostic.
- `@pen/react` keeps a small fallback list-input convenience path, but full markdown autoformat lives here.
- If you want custom rules, pass them through `inputRulesExtension({ rules, inlineRules })`.
