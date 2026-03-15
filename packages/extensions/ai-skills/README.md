# `@pen/ai-skills`

`@pen/ai-skills` packages Pen's native tool surface into agent-facing skill artifacts.

Use this package when you want to:

- generate `SKILL.md`-style artifacts for external agents
- attach helper scripts or references to a skill bundle
- keep skill instructions aligned with the same `@pen/ai-tools` registry used at runtime

## Usage

```ts
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { getAIToolRuntime, listAITools } from "@pen/ai-tools";
import { listDefaultAISkills, renderSkillFiles } from "@pen/ai-skills";

const editor = createEditor({
  preset: defaultPreset(),
});
const toolRuntime = getAIToolRuntime(editor);

if (!toolRuntime) {
  throw new Error("AI tools are unavailable.");
}

const skills = listDefaultAISkills(listAITools(toolRuntime));
const files = skills.flatMap((skill) => renderSkillFiles(skill));
```

`@pen/ai-skills` is an adapter/distribution package. It does not execute tools itself; it wraps the descriptors and instructions produced from `@pen/ai-tools`.
