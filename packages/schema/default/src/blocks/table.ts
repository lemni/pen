import { defineBlock, prop } from "@pen/types";
import type { Block } from "@pen/types";

function escapeMarkdownPipe(text: string): string {
  return text.replace(/\|/g, "\\|");
}

function escapeHTML(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getTableRows(block: Block): string[][] {
  const rows: string[][] = [];
  if (!block.children) return rows;
  for (const rowBlock of block.children) {
    const cells: string[] = [];
    if (rowBlock.children) {
      for (const cellBlock of rowBlock.children) {
        cells.push(cellBlock.content ?? "");
      }
    }
    rows.push(cells);
  }
  return rows;
}

export const table = defineBlock("table", {
  props: {
    hasHeaderRow: prop
      .boolean()
      .default(true)
      .describe("First row is a header"),
    hasHeaderColumn: prop
      .boolean()
      .default(false)
      .describe("First column is a header"),
    columnWidths: prop
      .array(prop.number())
      .optional()
      .describe("Column widths in pixels"),
  },
  content: "table",
  fieldEditor: "table",
  authoring: {
    flowCapability: "flow-delegated",
    selectionRole: "delegated",
  },
  display: {
    title: "Table",
    description: "Data table with rows and columns",
    group: "advanced",
    aliases: ["grid", "spreadsheet"],
  },
  serialize: {
    toMarkdown: (block) => {
      const rows = getTableRows(block);
      if (rows.length === 0) return "";
      const colCount = Math.max(...rows.map((r) => r.length), 1);
      const lines: string[] = [];

      const headerRow = rows[0] ?? [];
      const headerCells = Array.from({ length: colCount }, (_, i) =>
        escapeMarkdownPipe(headerRow[i] ?? ""),
      );
      lines.push(`| ${headerCells.join(" | ")} |`);
      lines.push(`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`);

      for (let r = 1; r < rows.length; r++) {
        const rowCells = Array.from({ length: colCount }, (_, i) =>
          escapeMarkdownPipe(rows[r][i] ?? ""),
        );
        lines.push(`| ${rowCells.join(" | ")} |`);
      }
      return lines.join("\n");
    },
    toHTML: (block) => {
      const rows = getTableRows(block);
      if (rows.length === 0) return "<table></table>";
      const hasHeader = block.props.hasHeaderRow as boolean;
      const colCount = Math.max(...rows.map((r) => r.length), 1);
      const parts: string[] = ["<table>"];

      if (hasHeader && rows.length > 0) {
        parts.push("<thead><tr>");
        const headerRow = rows[0] ?? [];
        for (let c = 0; c < colCount; c++) {
          parts.push(`<th>${escapeHTML(headerRow[c] ?? "")}</th>`);
        }
        parts.push("</tr></thead>");
      }

      const bodyStart = hasHeader ? 1 : 0;
      if (bodyStart < rows.length) {
        parts.push("<tbody>");
        for (let r = bodyStart; r < rows.length; r++) {
          parts.push("<tr>");
          for (let c = 0; c < colCount; c++) {
            parts.push(`<td>${escapeHTML(rows[r][c] ?? "")}</td>`);
          }
          parts.push("</tr>");
        }
        parts.push("</tbody>");
      }

      parts.push("</table>");
      return parts.join("");
    },
  },
});
