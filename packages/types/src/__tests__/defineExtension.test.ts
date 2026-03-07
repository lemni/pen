import { describe, it, expect } from "vitest";
import { defineExtension } from "../define-extension.js";

describe("defineExtension", () => {
  it("produces extension with default version", () => {
    const ext = defineExtension({ name: "my-ext" });
    expect(ext.name).toBe("my-ext");
    expect(ext.version).toBe("0.0.0");
  });

  it("preserves custom version", () => {
    const ext = defineExtension({ name: "x", version: "1.0.0" });
    expect(ext.version).toBe("1.0.0");
  });

  it("preserves all fields", () => {
    const inputRule = {
      id: "test-rule",
      match: /^# /,
      handler: () => null,
    };
    const ext = defineExtension({
      name: "x",
      version: "1.0.0",
      inputRules: [inputRule],
    });
    expect(ext.inputRules).toHaveLength(1);
    expect(ext.inputRules![0].id).toBe("test-rule");
  });

  it("preserves dependencies", () => {
    const ext = defineExtension({
      name: "x",
      dependencies: ["y", "z"],
    });
    expect(ext.dependencies).toEqual(["y", "z"]);
  });
});
