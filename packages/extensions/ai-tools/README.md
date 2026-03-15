# `@pen/ai-tools`

`@pen/ai-tools` is the canonical public tool surface for Pen agents and direct editor-attached AI flows.

Start here when you need to:

- resolve the active tool runtime from a Pen editor
- list tool descriptors for an agent runtime
- execute tools against the editor's shared `ToolRuntime`
- buffer progressive tool output into stable JSON-friendly results

## Usage

```ts
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import {
  getAIToolRuntime,
  listAITools,
  executeAITool,
  AIToolContextImpl,
} from "@pen/ai-tools";

const editor = createEditor({
  preset: defaultPreset(),
});
const toolRuntime = getAIToolRuntime(editor);

if (!toolRuntime) {
  throw new Error("AI tools are unavailable.");
}

const tools = listAITools(toolRuntime);
const context = new AIToolContextImpl(editor, "doc-1", () => {});
const result = await executeAITool(toolRuntime, "read_document", {}, context);
```

`@pen/ai-tools` builds on the same document semantics as `@pen/document-ops`; it does not fork or replace them.
