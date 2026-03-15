import type { DOMNode } from "./domAdapter";
import { parseInlineContent } from "./inlineParser";
import type {
  BlockImportMatch,
  DatabaseViewState,
  HTMLImportElement,
  HTMLImportNode,
  SchemaRegistry,
  TableColumnSchema,
} from "@pen/types";
import type { PendingBlock } from "@pen/core";
import { normalizeStoredSelectValue } from "@pen/types";

const BLOCK_ELEMENT_MAP: Record<string, (node: DOMNode) => PendingBlock> = {
  h1: (node) => blockWithInline("heading", { level: 1 }, node),
  h2: (node) => blockWithInline("heading", { level: 2 }, node),
  h3: (node) => blockWithInline("heading", { level: 3 }, node),
  h4: (node) => blockWithInline("heading", { level: 4 }, node),
  h5: (node) => blockWithInline("heading", { level: 5 }, node),
  h6: (node) => blockWithInline("heading", { level: 6 }, node),
  p: (node) => blockWithInline("paragraph", {}, node),
  blockquote: (node) => blockWithInline("blockquote", {}, node),
  hr: () => ({ type: "divider", props: {} }),
  pre: (node) => {
    const codeNode = node.children?.find((c) => c.tagName === "code");
    const langClass = codeNode?.attributes?.class ?? "";
    const langMatch = langClass.match(/language-(\S+)/);
    const text = extractText(codeNode ?? node);
    return {
      type: "codeBlock",
      props: { language: langMatch?.[1] ?? undefined },
      content: text,
    };
  },
  img: (node) => ({
    type: "image",
    props: {
      src: node.attributes?.src ?? "",
      alt: node.attributes?.alt ?? undefined,
      caption: node.attributes?.title ?? undefined,
    },
  }),
};

export function domToBlocks(
  root: DOMNode,
  registry: SchemaRegistry,
): PendingBlock[] {
  const blocks: PendingBlock[] = [];
  walkElements(root, blocks, registry);
  return blocks;
}

function walkElements(
  node: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
): void {
  if (node.type === "text") {
    const text = (node.textContent ?? "").trim();
    if (text) {
      blocks.push({ type: "paragraph", props: {}, content: text });
    }
    return;
  }

  if (node.type !== "element" || !node.tagName) {
    for (const child of node.children ?? []) {
      walkElements(child, blocks, registry);
    }
    return;
  }

  const schemaBlock = resolveFromHTMLSchema(node, registry);
  if (schemaBlock) {
    if (schemaBlock.content === undefined) {
      const inlineSource = getHtmlInlineSource(schemaBlock, node);
      if (!inlineSource) {
        blocks.push(schemaBlock);
        return;
      }
      const inline = parseInlineContent(inlineSource);
      schemaBlock.content = inline.text;
      schemaBlock.marks = inline.marks;
    }
    blocks.push(schemaBlock);
    return;
  }

  const handler = BLOCK_ELEMENT_MAP[node.tagName];
  if (handler) {
    blocks.push(handler(node));
    return;
  }

  if (node.tagName === "ul" || node.tagName === "ol") {
    walkList(node, blocks, registry, 0, node.tagName === "ol");
    return;
  }

  if (node.tagName === "table") {
    blocks.push(parseHTMLTable(node));
    return;
  }

  if (isBlockElement(node.tagName)) {
    for (const child of node.children ?? []) {
      walkElements(child, blocks, registry);
    }
    return;
  }

  const inline = parseInlineContent(node);
  if (inline.text.trim()) {
    blocks.push({
      type: "paragraph",
      props: {},
      content: inline.text,
      marks: inline.marks,
    });
  }
}

function walkList(
  node: DOMNode,
  blocks: PendingBlock[],
  registry: SchemaRegistry,
  indent: number,
  ordered: boolean,
): void {
  const items = (node.children ?? []).filter((c) => c.tagName === "li");
  const olStart = ordered ? parseOlStart(node) : undefined;

  for (let itemIdx = 0; itemIdx < items.length; itemIdx++) {
    const li = items[itemIdx];
    const checkbox = li.children?.find(
      (c) =>
        c.tagName === "input" && c.attributes?.type === "checkbox",
    );

    const inlineChildren = (li.children ?? []).filter(
      (c) =>
        c.tagName !== "ul" &&
        c.tagName !== "ol" &&
        !(c.tagName === "input" && c.attributes?.type === "checkbox"),
    );
    const inline = parseInlineContent({
      type: "element",
      tagName: "span",
      children: inlineChildren,
    });

    if (checkbox) {
      blocks.push({
        type: "checkListItem",
        props: {
          indent,
          checked: checkbox.attributes?.checked !== undefined,
        },
        content: inline.text,
        marks: inline.marks,
      });
    } else if (ordered) {
      blocks.push({
        type: "numberedListItem",
        props: {
          indent,
          start: itemIdx === 0 ? olStart : undefined,
        },
        content: inline.text,
        marks: inline.marks,
      });
    } else {
      blocks.push({
        type: "bulletListItem",
        props: { indent },
        content: inline.text,
        marks: inline.marks,
      });
    }

    for (const child of li.children ?? []) {
      if (child.tagName === "ul" || child.tagName === "ol") {
        walkList(child, blocks, registry, indent + 1, child.tagName === "ol");
      }
    }
  }
}

function parseOlStart(node: DOMNode): number | undefined {
  const raw = node.attributes?.start;
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

function parseHTMLTable(node: DOMNode): PendingBlock {
  const databasePayload = parseDatabasePayload(
    node.attributes?.["data-pen-database"],
  );
  if (databasePayload) {
    return {
      type: "database",
      props: {
        title:
          typeof databasePayload.title === "string"
            ? databasePayload.title
            : "Untitled",
        dataSource:
          databasePayload.dataSource === "remote" ||
          databasePayload.dataSource === "hybrid"
            ? databasePayload.dataSource
            : "local",
      },
      database: {
        columns: databasePayload.columns,
        rows: databasePayload.rows,
        views: databasePayload.views,
        primaryViewId: databasePayload.primaryViewId ?? null,
      },
    };
  }

  const typedDatabase = parseTypedDatabaseTable(node);
  if (typedDatabase) {
    return typedDatabase;
  }

  const hasHeaderRow = (node.children ?? []).some(
    (c) => c.tagName === "thead",
  );

  const rows: PendingBlock[] = [];
  const allRows = collectTableRows(node);
  for (let rowIdx = 0; rowIdx < allRows.length; rowIdx++) {
    const row = allRows[rowIdx];
    const cells: PendingBlock[] = [];
    const cellNodes = (row.children ?? []).filter(
      (c) => c.tagName === "td" || c.tagName === "th",
    );
    for (let colIdx = 0; colIdx < cellNodes.length; colIdx++) {
      const inline = parseInlineContent(cellNodes[colIdx]);
      cells.push({
        type: "__table_cell",
        props: { _rowIndex: rowIdx, _colIndex: colIdx },
        content: inline.text,
        marks: inline.marks,
      });
    }
    rows.push({
      type: "__table_row",
      props: { _rowIndex: rowIdx },
      children: cells,
    });
  }

  return {
    type: "table",
    props: { hasHeaderRow, hasHeaderColumn: false },
    children: rows,
  };
}

function parseTypedDatabaseTable(node: DOMNode): PendingBlock | null {
  const headerCells = collectDatabaseHeaderCells(node);
  if (headerCells.length === 0) {
    return null;
  }

  const columns = headerCells.map((cell, index) => {
    const columnId = cell.attributes?.["data-col-id"]?.trim() || `col-${index}`;
    const columnType = cell.attributes?.["data-col-type"]?.trim() || "text";
    const inline = parseInlineContent(cell);
    const options = parseEncodedJSON(cell.attributes?.["data-col-options"]);
    const format = parseEncodedJSON(cell.attributes?.["data-col-format"]);
    const width = cell.attributes?.["data-col-width"];
    const pinned = cell.attributes?.["data-col-pinned"];
    const column: TableColumnSchema = {
      id: columnId,
      title: inline.text || `Column ${index + 1}`,
      type: columnType as TableColumnSchema["type"],
    };

    if (Array.isArray(options)) {
      column.options = options as TableColumnSchema["options"];
    }
    if (format && typeof format === "object") {
      column.format = format as TableColumnSchema["format"];
    }
    if (width != null && width !== "" && Number.isFinite(Number(width))) {
      column.width = Number(width);
    }
    if (pinned === "left" || pinned === "right") {
      column.pinned = pinned;
    }
    if (cell.attributes?.["data-col-hidden"] !== undefined) {
      column.hidden = cell.attributes["data-col-hidden"] === "true";
    }
    if (cell.attributes?.["data-col-readonly"] !== undefined) {
      column.readonly = cell.attributes["data-col-readonly"] === "true";
    }

    return column;
  });

  const bodyRows = collectDatabaseBodyRows(node);
  const rows = bodyRows.map((row, rowIndex) => {
    const cellNodes = (row.children ?? []).filter((child) => child.tagName === "td" || child.tagName === "th");
    const values = Object.fromEntries(
      columns.map((column, columnIndex) => {
        const raw = parseInlineContent(cellNodes[columnIndex] ?? { type: "element", tagName: "span", children: [] }).text;
        return [column.id, coerceImportedCellValue(raw, column)];
      }),
    );

    return {
      id: `row-${rowIndex}`,
      values,
    };
  });

  return {
    type: "database",
    props: {
      title: "Untitled",
      dataSource: "local",
    },
    database: {
      columns,
      rows,
      views: undefined,
      primaryViewId: null,
    },
  };
}

function coerceImportedCellValue(raw: string, column: TableColumnSchema): string {
  if (!raw || !column.options?.length) {
    return raw;
  }
  if (column.type === "select") {
    return normalizeStoredSelectValue(raw, column.options);
  }
  if (column.type === "multiSelect") {
    let parsed: string[];
    try {
      const json = JSON.parse(raw);
      parsed = Array.isArray(json) ? json.map(String) : [raw];
    } catch {
      parsed = raw.split(",").map((s) => s.trim()).filter(Boolean);
    }
    const normalized = parsed.map((v) => normalizeStoredSelectValue(v, column.options));
    return normalized.length > 0 ? JSON.stringify(normalized) : raw;
  }
  return raw;
}

function parseDatabasePayload(
  rawValue: string | undefined,
): {
  title?: string;
  dataSource?: string;
  columns: TableColumnSchema[];
  rows: Array<{ id: string; values: Record<string, string> }>;
  views?: DatabaseViewState[];
  primaryViewId?: string | null;
} | null {
  if (!rawValue) {
    return null;
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(rawValue)) as {
      title?: string;
      dataSource?: string;
      columns?: TableColumnSchema[];
      rows?: Array<{ id?: string; values?: Record<string, unknown> }>;
      views?: DatabaseViewState[];
      primaryViewId?: string | null;
    };
    if (!Array.isArray(parsed.columns) || !Array.isArray(parsed.rows)) {
      return null;
    }
    return {
      title: parsed.title,
      dataSource: parsed.dataSource,
      columns: parsed.columns,
      rows: parsed.rows.map((row, index) => ({
        id:
          typeof row?.id === "string" && row.id.length > 0
            ? row.id
            : `row-${index}`,
        values: Object.fromEntries(
          Object.entries(row?.values ?? {}).map(([key, value]) => [
            key,
            value == null ? "" : String(value),
          ]),
        ),
      })),
      views: Array.isArray(parsed.views) ? parsed.views : undefined,
      primaryViewId:
        typeof parsed.primaryViewId === "string" || parsed.primaryViewId === null
          ? parsed.primaryViewId
          : undefined,
    };
  } catch {
    return null;
  }
}

function collectTableRows(tableNode: DOMNode): DOMNode[] {
  const rows: DOMNode[] = [];
  for (const child of tableNode.children ?? []) {
    if (child.tagName === "tr") {
      rows.push(child);
    } else if (
      child.tagName === "thead" ||
      child.tagName === "tbody" ||
      child.tagName === "tfoot"
    ) {
      for (const row of child.children ?? []) {
        if (row.tagName === "tr") rows.push(row);
      }
    }
  }
  return rows;
}

function collectDatabaseHeaderCells(tableNode: DOMNode): DOMNode[] {
  const headerRow =
    tableNode.children?.find((child) => child.tagName === "thead")?.children?.find(
      (child) => child.tagName === "tr",
    ) ??
    collectTableRows(tableNode).find((row) =>
      (row.children ?? []).some((child) => child.tagName === "th" && child.attributes?.["data-col-type"] != null),
    ) ??
    null;

  if (!headerRow) {
    return [];
  }

  const headerCells = (headerRow.children ?? []).filter((child) => child.tagName === "th");
  const isTyped = headerCells.some(
    (cell) =>
      cell.attributes?.["data-col-type"] != null ||
      cell.attributes?.["data-col-id"] != null,
  );
  return isTyped ? headerCells : [];
}

function collectDatabaseBodyRows(tableNode: DOMNode): DOMNode[] {
  const tbody = tableNode.children?.find((child) => child.tagName === "tbody");
  if (tbody) {
    return (tbody.children ?? []).filter((child) => child.tagName === "tr");
  }

  const allRows = collectTableRows(tableNode);
  return allRows.slice(1);
}

function parseEncodedJSON(rawValue: string | undefined): unknown {
  if (!rawValue) {
    return undefined;
  }

  try {
    return JSON.parse(decodeURIComponent(rawValue));
  } catch {
    return undefined;
  }
}

function blockWithInline(
  type: string,
  props: Record<string, unknown>,
  node: DOMNode,
): PendingBlock {
  const inline = parseInlineContent(node);
  return { type, props, content: inline.text, marks: inline.marks };
}

function extractText(node: DOMNode): string {
  if (node.type === "text") return node.textContent ?? "";
  return (node.children ?? []).map(extractText).join("");
}

const BLOCK_ELEMENTS = new Set([
  "div",
  "section",
  "article",
  "main",
  "aside",
  "header",
  "footer",
  "nav",
  "figure",
  "figcaption",
  "fieldset",
  "legend",
  "address",
  "hgroup",
]);

function isBlockElement(tagName: string): boolean {
  return BLOCK_ELEMENTS.has(tagName);
}

function resolveFromHTMLSchema(
  node: DOMNode,
  registry: SchemaRegistry,
): BlockImportMatch | null {
  if (!registry.resolve) return null;
  const blockSchemas = registry.allBlocks?.() ?? [];
  const htmlElement = toHTMLImportElement(node);
  for (const schema of blockSchemas) {
    if (schema.serialize?.fromHTML && htmlElement) {
      const result = schema.serialize.fromHTML(htmlElement);
      if (result) return result;
    }
  }
  return null;
}

function toHTMLImportElement(node: DOMNode): HTMLImportElement | null {
  if (node.type !== "element" || !node.tagName) {
    return null;
  }
  const attributes = { ...(node.attributes ?? {}) };
  const children = (node.children ?? [])
    .map(toHTMLImportNode)
    .filter((child): child is HTMLImportNode => child !== null);
  return {
    type: "element",
    tagName: node.tagName,
    attributes,
    children,
    textContent: node.textContent,
    getAttribute(name: string) {
      return attributes[name] ?? null;
    },
    hasAttribute(name: string) {
      return Object.hasOwn(attributes, name);
    },
  };
}

function toHTMLImportNode(node: DOMNode): HTMLImportNode | null {
  if (node.type === "text") {
    return {
      type: "text",
      textContent: node.textContent ?? "",
    };
  }
  return toHTMLImportElement(node);
}

function getHtmlInlineSource(
  block: BlockImportMatch,
  fallbackNode: DOMNode,
): DOMNode | null {
  if (block.type === "codeBlock" || block.type === "table") {
    return null;
  }

  const explicitSource = block.importContentSource?.htmlElement;
  if (explicitSource) {
    return explicitSource as unknown as DOMNode;
  }

  if (block.content === undefined) {
    return fallbackNode;
  }

  return null;
}
