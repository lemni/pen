import { describe, it, expect } from "vitest";
import { defineBlock } from "../define-block.js";
import { prop } from "../prop.js";

describe("defineBlock", () => {
  it("Form 1: type as first arg", () => {
    const schema = defineBlock("heading", {
      props: { level: prop.enum([1, 2, 3]) },
      content: "inline",
    });

    expect(schema.type).toBe("heading");
    expect(schema.propSchema.level).toBeDefined();
    expect(schema.propSchema.level.type).toBe("number");
    expect(schema.propSchema.level.enum).toEqual([1, 2, 3]);
    expect(schema.content).toBe("inline");
    expect(schema.display?.title).toBe("Heading");
    expect(schema.aiDescription).toContain("heading");
    expect(schema.aiDescription).toContain("level");
  });

  it("Form 2: single object arg with type key", () => {
    const schema = defineBlock({
      type: "table",
      propSchema: { hasHeaderRow: prop.boolean() },
      content: "table",
    });

    expect(schema.type).toBe("table");
    expect(schema.propSchema.hasHeaderRow).toBeDefined();
    expect(schema.propSchema.hasHeaderRow.type).toBe("boolean");
    expect(schema.content).toBe("table");
  });

  it("generates validateProps that applies defaults", () => {
    const schema = defineBlock("heading", {
      props: { level: prop.enum([1, 2, 3]) },
      content: "inline",
    });

    expect(schema.validateProps).toBeTypeOf("function");
    const result = schema.validateProps!({});
    expect(result).toEqual({ level: 1 });
  });

  it("validateProps clamps numbers", () => {
    const schema = defineBlock("spacer", {
      props: { height: prop.number().min(10).max(500) },
      content: "none",
    });

    expect(schema.validateProps!({ height: 5 })).toEqual({ height: 10 });
    expect(schema.validateProps!({ height: 999 })).toEqual({ height: 500 });
    expect(schema.validateProps!({ height: 100 })).toEqual({ height: 100 });
  });

  it("validateProps coerces string to number", () => {
    const schema = defineBlock("heading", {
      props: { level: prop.enum([1, 2, 3]) },
    });

    expect(schema.validateProps!({ level: "2" })).toEqual({ level: 2 });
  });

  it("validateProps rejects invalid enum value", () => {
    const schema = defineBlock("heading", {
      props: { level: prop.enum([1, 2, 3]) },
    });

    expect(schema.validateProps!({ level: 99 })).toEqual({ level: 1 });
  });

  it("camelCase type name converts to title case", () => {
    const schema = defineBlock("bulletListItem", { content: "inline" });
    expect(schema.display?.title).toBe("Bullet List Item");
  });

  it("content defaults to inline", () => {
    const schema = defineBlock("paragraph", {});
    expect(schema.content).toBe("inline");
  });

  it("serialize defaults to empty object", () => {
    const schema = defineBlock("paragraph", {});
    expect(schema.serialize).toEqual({});
  });

  it("no props → no validateProps", () => {
    const schema = defineBlock("divider", { content: "none" });
    expect(schema.validateProps).toBeUndefined();
  });

  it("custom display overrides default", () => {
    const schema = defineBlock("heading", {
      display: { title: "Custom Title", icon: "H" },
    });
    expect(schema.display?.title).toBe("Custom Title");
    expect(schema.display?.icon).toBe("H");
  });

  it("enum with number values infers number type", () => {
    const schema = defineBlock("heading", {
      props: { level: prop.enum([1, 2, 3]) },
    });
    expect(schema.propSchema.level.type).toBe("number");
  });
});
