# `@pen/ai`

AI extension, suggest mode, review state, and planning/runtime helpers for Pen.

This package is published publicly as part of the Pen source-available SDK. Production
use requires a license from Input.

## Install

```bash
pnpm add @pen/core @pen/ai
```

Most app integrations also pair it with a renderer such as `@pen/react`.

## What It Provides

- `aiExtension(...)` to install Pen's headless AI runtime
- controller accessors such as `getAIController()` and `getAIReviewController()`
- suggest-mode and persistent-suggestion helpers
- planning, mutation-receipt, and review utilities used by richer AI workflows

## Minimal Setup

```ts
import { createEditor } from "@pen/core";
import { aiExtension, getAIController } from "@pen/ai";

const editor = createEditor({
  extensions: [
    aiExtension({
      suggestMode: true,
      author: "Ada",
    }),
  ],
});

const ai = getAIController(editor);
```

## Integration Notes

- `@pen/ai` is headless. It installs runtime behavior and controller state, not a fixed UI.
- Suggest mode lets AI-authored edits flow through Pen's suggestion and review pipeline instead of immediately replacing document content.
- The host application still owns model adapters, auth, transport, and any product-specific orchestration.

## Typical Pairing

- `@pen/core` for editor authority and document mutation
- `@pen/react` for AI surfaces, prompts, and review UI
- `@pen/ai-autocomplete` or `@pen/ai-suggestions` for narrower inline flows
- `@pen/document-ops` when AI actions should route through document tools
