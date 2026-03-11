import { describe, expect, it } from "vitest";
import { defineBlock } from "../defineBlock";
import {
  getBlockSelectionRoleFromSchema,
  getBlockSelectionRoleFromType,
  getFlowCapabilityFromSchema,
  getFlowCapabilityFromType,
  shouldAllowDirectBlockPaste,
  shouldExposeBlockInTooling,
  shouldShowBlockInDefaultMenus,
} from "../index";

describe("block capability helpers", () => {
  it("respects explicit authoring metadata", () => {
    const schema = defineBlock("subdocument", {
      content: "subdocument",
      fieldEditor: "none",
      authoring: {
        flowCapability: "flow-delegated",
        selectionRole: "delegated",
      },
    });

    expect(getFlowCapabilityFromSchema(schema)).toBe("flow-delegated");
    expect(getBlockSelectionRoleFromSchema(schema)).toBe("delegated");
  });

  it("keeps code editors inline-editable by default", () => {
    const schema = defineBlock("codeBlock", {
      content: "inline",
      fieldEditor: "code",
      authoring: {
        selectionRole: "delegated",
      },
    });

    expect(getFlowCapabilityFromSchema(schema)).toBe("flow-inline");
    expect(getBlockSelectionRoleFromSchema(schema)).toBe("delegated");
  });

  it("keeps only explicit legacy type fallbacks for schema-less payloads", () => {
    expect(getFlowCapabilityFromType("database")).toBe("flow-disallowed");
    expect(getFlowCapabilityFromType("subdocument")).toBe("flow-delegated");
    expect(getFlowCapabilityFromType("customWidget")).toBe(null);
    expect(getBlockSelectionRoleFromType("image")).toBe("structural");
    expect(getBlockSelectionRoleFromType("codeBlock")).toBe("delegated");
  });

  it("hides hidden and subdocument blocks from default menus", () => {
    const hiddenBlock = defineBlock("hiddenBlock", {
      content: "inline",
      display: {
        title: "Hidden Block",
        hidden: true,
      },
    });
    const subdocumentBlock = defineBlock("subdocument", {
      content: "subdocument",
      fieldEditor: "subdocument",
      display: {
        title: "Subdocument",
      },
    });

    expect(shouldShowBlockInDefaultMenus("structured", hiddenBlock)).toBe(false);
    expect(shouldShowBlockInDefaultMenus("structured", subdocumentBlock)).toBe(
      false,
    );
  });

  it("filters hidden and flow-disallowed blocks from tooling surfaces", () => {
    const hiddenBlock = defineBlock("hiddenBlock", {
      content: "inline",
      display: {
        title: "Hidden Block",
        hidden: true,
      },
    });
    const databaseBlock = defineBlock("database", {
      content: "database",
      fieldEditor: "database",
      display: {
        title: "Database",
      },
    });

    expect(shouldExposeBlockInTooling("structured", hiddenBlock)).toBe(false);
    expect(shouldExposeBlockInTooling("structured", databaseBlock)).toBe(true);
    expect(shouldExposeBlockInTooling("flow", databaseBlock)).toBe(false);
  });

  it("treats unknown block capabilities as ineligible for direct flow paste", () => {
    expect(shouldAllowDirectBlockPaste("flow", null)).toBe(false);
    expect(shouldAllowDirectBlockPaste("flow", "flow-inline")).toBe(true);
  });
});
