import { describe, expect, it } from "vitest";
import type { AIToolDescriptor } from "@pen/ai-tools";
import type { AutocompleteProviderDescriptor } from "@pen/ai-autocomplete";
import {
  AISkillRegistry,
  createAutocompleteProviderSkill,
  createDocumentAgentSkill,
  listDefaultAISkills,
  renderSkillFiles,
  renderSkillMarkdown,
} from "../index";

const tools: readonly AIToolDescriptor[] = [
  {
    name: "read_document",
    description: "Read document content.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "write_document",
    description: "Write document content.",
    inputSchema: { type: "object", properties: {} },
  },
];

const providers: readonly AutocompleteProviderDescriptor[] = [
  {
    id: "route-hint",
    description: "Adds the current route to autocomplete context.",
    kind: "consumer",
  },
];

describe("@pen/ai-skills", () => {
  it("creates a default document skill from ai-tools descriptors", () => {
    const [skill] = listDefaultAISkills(tools);

    expect(skill?.name).toBe("pen-document-agent");
    expect(skill?.tools).toEqual(tools);
  });

  it("includes an autocomplete provider skill when provider descriptors are supplied", () => {
    const skills = listDefaultAISkills(tools, {
      autocompleteProviders: providers,
    });

    expect(skills.map((skill) => skill.name)).toContain(
      "pen-autocomplete-context",
    );
  });

  it("renders a skill markdown artifact", () => {
    const markdown = renderSkillMarkdown(createDocumentAgentSkill(tools));

    expect(markdown).toContain("name: pen-document-agent");
    expect(markdown).toContain("`read_document`");
    expect(markdown).toContain("## How It Works");
  });

  it("renders skill files including scripts and references", () => {
    const files = renderSkillFiles(createDocumentAgentSkill(tools));

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "pen-document-agent/SKILL.md",
        "pen-document-agent/scripts/print-tools.sh",
        "pen-document-agent/references/tools.json",
      ]),
    );
  });

  it("renders autocomplete provider references as skill artifacts", () => {
    const files = renderSkillFiles(createAutocompleteProviderSkill(providers));

    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining([
        "pen-autocomplete-context/SKILL.md",
        "pen-autocomplete-context/references/providers.json",
      ]),
    );
    expect(
      files.find((file) => file.path.endsWith("providers.json"))?.content,
    ).toContain("route-hint");
  });

  it("registers and retrieves skills", () => {
    const registry = new AISkillRegistry();
    const skill = createDocumentAgentSkill(tools);

    registry.register(skill);

    expect(registry.get(skill.name)).toEqual(skill);
    expect(registry.list()).toHaveLength(1);
  });
});
