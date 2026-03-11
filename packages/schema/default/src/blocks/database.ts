import {
	DEFAULT_DATABASE_COLUMN_WIDTH,
	defineBlock,
	formatStoredMultiSelectValue,
	formatStoredSelectValue,
	prop,
} from "@pen/types";
import type { Block, DatabaseViewState, TableColumnSchema } from "@pen/types";

function escapeHTML(str: string): string {
	return str
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function escapeMarkdownPipe(text: string): string {
	return text.replace(/\|/g, "\\|");
}

function getDatabaseRows(block: Block): string[][] {
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

interface DatabaseBlock extends Block {
	databaseData?: {
		title?: string;
		dataSource?: string;
		defaultColumnWidth?: number;
		columns: TableColumnSchema[];
		rows: Array<{ id: string; values: Record<string, string> }>;
		views?: DatabaseViewState[];
		primaryViewId?: string | null;
	};
}

function formatCellValue(
	rawValue: string,
	column: TableColumnSchema,
): string {
	if (!rawValue) return "";
	switch (column.type) {
		case "checkbox":
			return rawValue.toLowerCase() === "true" ? "true" : "false";
		case "number":
			return rawValue;
		case "date":
			return rawValue;
		case "select":
			return formatStoredSelectValue(rawValue, column.options);
		case "multiSelect":
			return formatStoredMultiSelectValue(rawValue, column.options);
		default:
			return rawValue;
	}
}

function encodeDatabasePayload(data: NonNullable<DatabaseBlock["databaseData"]>): string {
	return encodeURIComponent(JSON.stringify(data));
}

function encodeColumnMetadata(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

function buildColumnMetadataAttributes(column: TableColumnSchema): string {
  const attrs = [
    `data-col-id="${escapeHTML(column.id)}"`,
    `data-col-type="${escapeHTML(column.type)}"`,
  ];

  if (column.options && column.options.length > 0) {
    attrs.push(
      `data-col-options="${escapeHTML(encodeColumnMetadata(column.options))}"`,
    );
  }
  if (column.format) {
    attrs.push(
      `data-col-format="${escapeHTML(encodeColumnMetadata(column.format))}"`,
    );
  }
  if (column.readonly !== undefined) {
    attrs.push(`data-col-readonly="${column.readonly ? "true" : "false"}"`);
  }
  if (column.hidden !== undefined) {
    attrs.push(`data-col-hidden="${column.hidden ? "true" : "false"}"`);
  }
  if (column.width !== undefined) {
    attrs.push(`data-col-width="${escapeHTML(String(column.width))}"`);
  }
  if (column.pinned) {
    attrs.push(`data-col-pinned="${escapeHTML(column.pinned)}"`);
  }

  return attrs.join(" ");
}

export const database = defineBlock("database", {
	props: {
		title: prop.string().default("Untitled").describe("Database title"),
		dataSource: prop
			.enum(["local", "remote", "hybrid"] as const)
			.default("local"),
		defaultColumnWidth: prop
			.number()
			.default(DEFAULT_DATABASE_COLUMN_WIDTH)
			.min(1)
			.describe("Default width in pixels for columns without an explicit width"),
	},
	content: "database",
	fieldEditor: "database",
	authoring: {
		flowCapability: "flow-disallowed",
		selectionRole: "delegated",
	},
	display: {
		title: "Database",
		description: "Structured data with typed columns, views, and queries",
		group: "advanced",
		aliases: ["spreadsheet", "dataset"],
	},
	serialize: {
		toMarkdown: (block) => {
			const data = (block as DatabaseBlock).databaseData;
			if (data && data.columns.length > 0) {
				const lines: string[] = [];
				lines.push(`<!-- pen-database:${encodeDatabasePayload(data)} -->`);
				const headerCells = data.columns.map((column) => escapeMarkdownPipe(column.title));
				lines.push(`| ${headerCells.join(" | ")} |`);
				lines.push(`| ${data.columns.map(() => "---").join(" | ")} |`);
				for (const row of data.rows) {
					const rowCells = data.columns.map((column) =>
						escapeMarkdownPipe(formatCellValue(row.values[column.id] ?? "", column)),
					);
					lines.push(`| ${rowCells.join(" | ")} |`);
				}
				return lines.join("\n");
			}
			const rows = getDatabaseRows(block);
			if (rows.length === 0) return "";
			const colCount = Math.max(...rows.map((r) => r.length), 1);
			const lines: string[] = [];

			const headerRow = rows[0] ?? [];
			const headerCells = Array.from({ length: colCount }, (_, i) =>
				escapeMarkdownPipe(headerRow[i] ?? ""),
			);
			lines.push(`| ${headerCells.join(" | ")} |`);
			lines.push(
				`| ${Array.from({ length: colCount }, () => "---").join(" | ")} |`,
			);

			for (let r = 1; r < rows.length; r++) {
				const rowCells = Array.from({ length: colCount }, (_, i) =>
					escapeMarkdownPipe(rows[r]![i] ?? ""),
				);
				lines.push(`| ${rowCells.join(" | ")} |`);
			}
			return lines.join("\n");
		},
		toHTML: (block) => {
			const data = (block as DatabaseBlock).databaseData;
			if (data && data.columns.length > 0) {
				const parts: string[] = [
					`<table data-pen-database="${escapeHTML(encodeDatabasePayload(data))}">`,
				];
				parts.push("<thead><tr>");
				for (const column of data.columns) {
					parts.push(
            `<th ${buildColumnMetadataAttributes(column)}>${escapeHTML(column.title)}</th>`,
					);
				}
				parts.push("</tr></thead>");
				if (data.rows.length > 0) {
					parts.push("<tbody>");
					for (const row of data.rows) {
						parts.push("<tr>");
						for (const column of data.columns) {
							parts.push(
								`<td>${escapeHTML(formatCellValue(row.values[column.id] ?? "", column))}</td>`,
							);
						}
						parts.push("</tr>");
					}
					parts.push("</tbody>");
				}
				parts.push("</table>");
				return parts.join("");
			}
			const rows = getDatabaseRows(block);
			if (rows.length === 0) return "<table></table>";
			const colCount = Math.max(...rows.map((r) => r.length), 1);
			const parts: string[] = ["<table>"];

			parts.push("<thead><tr>");
			const headerRow = rows[0] ?? [];
			for (let c = 0; c < colCount; c++) {
				parts.push(`<th>${escapeHTML(headerRow[c] ?? "")}</th>`);
			}
			parts.push("</tr></thead>");

			if (rows.length > 1) {
				parts.push("<tbody>");
				for (let r = 1; r < rows.length; r++) {
					parts.push("<tr>");
					for (let c = 0; c < colCount; c++) {
						parts.push(`<td>${escapeHTML(rows[r]![c] ?? "")}</td>`);
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
