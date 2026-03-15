import { describe, expect, it } from "vitest";
import { createEditor } from "@pen/core";
import { createDefaultSchema } from "@pen/schema-default";
import { markdownExporter } from "../exporter";

const noDefaultExtensionsPreset = {
  resolve() {
    return { extensions: [] };
  },
};

function databaseEditor() {
  const editor = createEditor({
    schema: createDefaultSchema(),
    preset: noDefaultExtensionsPreset,
  });
  editor.apply([{
    type: "insert-block",
    blockId: "d1",
    blockType: "database",
    props: {},
    position: "last",
  }]);
  return editor;
}

describe("database markdown export", () => {
  it("exports a database as a pipe table using tableColumns metadata", () => {
    const editor = databaseEditor();

    editor.apply([{
      type: "update-table-columns",
      blockId: "d1",
      columns: [
        { id: "name", title: "Name", type: "text" },
        { id: "tags", title: "Tags", type: "multiSelect" },
        { id: "status", title: "Status", type: "checkbox" },
      ],
    }]);
    editor.apply([{
      type: "database-insert-row",
      blockId: "d1",
      rowId: "row-1",
      values: {
        name: "Alice",
        tags: "alpha, beta",
        status: "true",
      },
    }]);

    const md = markdownExporter.export(editor);
    expect(md).toContain("<!-- pen-database:");
    expect(md).toContain("| Name | Tags | Status |");
    expect(md).toContain("| --- | --- | --- |");
    expect(md).toContain("| Alice | alpha, beta | true |");
    editor.destroy();
  });
});
