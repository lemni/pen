import type { Exporter, ExportOptions, Editor, BlockHandle, TableCellHandle } from "@pen/core";
import { buildTableChildren, buildDatabaseData, getNumberedListItemValue, sortDeltaAttributes } from "@pen/core";
import { groupListItems } from "./listGrouper";

export const markdownExporter: Exporter<string> = {
  name: "markdown",
  mimeType: "text/markdown",
  fileExtension: ".md",

  export(editor: Editor, _options?: ExportOptions): string {
    // Export is a document-preservation surface: serialize the actual document
    // graph, including nested and non-default-authoring blocks that already exist.
    const lines: string[] = [];
    for (const handle of editor.documentState.allBlocks()) {

      const schema = editor.schema.resolve(handle.type);
      if (!schema?.serialize?.toMarkdown) {
        lines.push(handle.textContent());
        continue;
      }

      const props =
        handle.type === "numberedListItem"
          ? {
              ...handle.props,
              start: getNumberedListItemValue(handle) ?? 1,
            }
          : handle.props;

      if (handle.type === "table") {
        lines.push(renderTableMarkdown(handle, editor));
        continue;
      }

      const block = {
        id: handle.id,
        type: handle.type,
        props,
        content: serializeInlineContent(handle, editor),
        children: buildTableChildren(handle),
        ...(handle.type === "database"
          ? { databaseData: buildDatabaseData(handle) }
          : {}),
      };

      lines.push(schema.serialize.toMarkdown(block));
    }

    return groupListItems(lines).join("\n\n");
  },
};

function serializeInlineContent(handle: BlockHandle, editor: Editor): string {
  const deltas = handle.textDeltas();
  if (!deltas || deltas.length === 0) return handle.textContent();

  let result = "";

  for (const delta of deltas) {
    let text = typeof delta.insert === "string" ? delta.insert : "";
    if (text === "\u200B") continue;

    if (delta.attributes) {
      const ordered = sortDeltaAttributes(delta.attributes, editor.schema);
      const marks = Object.entries(ordered);
      for (const [mark, props] of marks) {
        const inlineSchema = editor.schema.resolveInline(mark);
        if (!inlineSchema?.serialize?.toMarkdown) continue;
        text = inlineSchema.serialize.toMarkdown(
          text,
          typeof props === "object" ? (props as Record<string, unknown>) : {},
        );
      }
    }

    result += text;
  }

  return result;
}

function renderTableMarkdown(handle: BlockHandle, editor: Editor): string {
  const rows = readTableRows(handle, (cell) => serializeTableCellMarkdown(cell, editor));
  if (rows.length === 0) {
    return "";
  }

  const hasHeaderRow = handle.props.hasHeaderRow !== false;
  if (!hasHeaderRow) {
    return renderHtmlTableFallback(rows);
  }

  const colCount = Math.max(...rows.map((row) => row.length), 1);
  const lines: string[] = [];
  const headerRow = rows[0] ?? [];
  const headerCells = Array.from({ length: colCount }, (_, index) =>
    escapeMarkdownPipe(headerRow[index] ?? ""),
  );
  lines.push(`| ${headerCells.join(" | ")} |`);
  lines.push(`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);

  for (let rowIndex = 1; rowIndex < rows.length; rowIndex++) {
    const rowCells = Array.from({ length: colCount }, (_, index) =>
      escapeMarkdownPipe(rows[rowIndex]?.[index] ?? ""),
    );
    lines.push(`| ${rowCells.join(" | ")} |`);
  }

  return lines.join("\n");
}

function readTableRows(
  handle: BlockHandle,
  serializeCell: (cell: TableCellHandle | null) => string,
): string[][] {
  const rows: string[][] = [];
  const rowCount = handle.tableRowCount();
  const colCount = handle.tableColumnCount();

  for (let rowIndex = 0; rowIndex < rowCount; rowIndex++) {
    const row: string[] = [];
    for (let columnIndex = 0; columnIndex < colCount; columnIndex++) {
      row.push(serializeCell(handle.tableCell(rowIndex, columnIndex)));
    }
    rows.push(row);
  }

  return rows;
}

function serializeTableCellMarkdown(
  cell: TableCellHandle | null,
  editor: Editor,
): string {
  if (!cell) {
    return "";
  }

  let result = "";
  for (const delta of cell.textDeltas()) {
    let text = delta.insert;
    if (text === "\u200B") {
      continue;
    }

    if (delta.attributes) {
      const ordered = sortDeltaAttributes(delta.attributes, editor.schema);
      for (const [mark, props] of Object.entries(ordered)) {
        const inlineSchema = editor.schema.resolveInline(mark);
        if (!inlineSchema?.serialize?.toMarkdown) {
          continue;
        }
        text = inlineSchema.serialize.toMarkdown(
          text,
          typeof props === "object" ? (props as Record<string, unknown>) : {},
        );
      }
    }

    result += text;
  }

  return result;
}

function renderHtmlTableFallback(rows: string[][]): string {
  const parts = ["<table><tbody>"];
  for (const row of rows) {
    parts.push("<tr>");
    for (const cell of row) {
      parts.push(`<td>${escapeHTML(cell)}</td>`);
    }
    parts.push("</tr>");
  }
  parts.push("</tbody></table>");
  return parts.join("");
}

function escapeMarkdownPipe(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
