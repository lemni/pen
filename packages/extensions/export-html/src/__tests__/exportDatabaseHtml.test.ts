import { describe, expect, it } from "vitest";
import { createEditor } from "@pen/core";
import { createDefaultSchema } from "@pen/schema-default";
import { htmlExporter } from "../exporter";

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

describe("database HTML export", () => {
  it("exports a database as an HTML table using tableColumns metadata", () => {
    const editor = databaseEditor();

    editor.apply([{
      type: "update-table-columns",
      blockId: "d1",
      columns: [
        { id: "name", title: "Name", type: "text" },
        {
          id: "tags",
          title: "Tags",
          type: "multiSelect",
          options: [
            { id: "alpha", value: "Alpha" },
            { id: "beta", value: "Beta" },
          ],
        },
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

    const html = htmlExporter.export(editor);
    expect(html).toContain("<table");
    expect(html).toContain("data-pen-database=");
    expect(html).toContain(">Name</th>");
    expect(html).toContain(">Tags</th>");
    expect(html).toContain(">Status</th>");
    expect(html).toContain("data-col-id=\"tags\"");
    expect(html).toContain("data-col-type=\"checkbox\"");
    expect(html).toContain("data-col-options=");
    expect(html).toContain(">Alice</td>");
    expect(html).toContain(">alpha, beta</td>");
    expect(html).toContain(">true</td>");
    editor.destroy();
  });

  it("exports column metadata attributes for width, hidden, readonly, and pinned", () => {
    const editor = databaseEditor();

    editor.apply([{
      type: "update-table-columns",
      blockId: "d1",
      columns: [
        { id: "name", title: "Name", type: "text", width: 200 },
        { id: "notes", title: "Notes", type: "text", hidden: true, readonly: true },
        { id: "key", title: "Key", type: "text", pinned: "left" },
      ],
    }]);

    const html = htmlExporter.export(editor);
    expect(html).toContain('data-col-width="200"');
    expect(html).toContain('data-col-hidden="true"');
    expect(html).toContain('data-col-readonly="true"');
    expect(html).toContain('data-col-pinned="left"');
    editor.destroy();
  });
});
