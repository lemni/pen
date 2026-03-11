import type {
  CRDTAdapter,
  CRDTDocument,
  DocumentProfile,
  PenDocument,
} from "@pen/types";
import { generateId } from "@pen/types";
import * as Y from "yjs";

// ── Internal Types ──────────────────────────────────────────

export type BlockContentType =
  | "inline"
  | "table"
  | "database"
  | "subdocument"
  | "nested"
  | "none";

export interface YjsCRDTDocument extends CRDTDocument {
  readonly adapter: CRDTAdapter;
  readonly ydoc: Y.Doc;
  readonly penDocument: YjsPenDocument;
}

export interface YjsPenDocument extends PenDocument {
  readonly blockOrder: Y.Array<string>;
  readonly blocks: Y.Map<Y.Map<unknown>>;
  readonly apps: Y.Map<Y.Map<unknown>>;
  readonly metadata: Y.Map<unknown>;
  readonly adapter: CRDTAdapter;
}

export type YjsDoc = Y.Doc;
export type YjsMap<T = unknown> = Y.Map<T>;

export function asYjsDoc(doc: CRDTDocument): YjsCRDTDocument {
  return doc as YjsCRDTDocument;
}

export function isYjsDoc(value: unknown): value is Y.Doc {
  return value instanceof Y.Doc;
}

export function isYjsMap<T = unknown>(value: unknown): value is Y.Map<T> {
  return value instanceof Y.Map;
}

export function createYjsSubdocument(
  parent: Y.Doc,
  options?: {
    guid?: string;
    autoLoad?: boolean;
  },
): Y.Doc {
  return new Y.Doc({
    guid: options?.guid,
    autoLoad: options?.autoLoad ?? true,
    gc: parent.gc,
  });
}

// ── Constants ───────────────────────────────────────────────

export const BLOCK_ORDER = "blockOrder";
export const BLOCKS = "blocks";
export const APPS = "apps";
export const METADATA = "metadata";
export const SUBDOCUMENT = "subdocument";
export const DOCUMENT_PROFILE = "documentProfile";

// ── Document Validation ─────────────────────────────────────

export interface DocumentValidationResult {
  valid: boolean;
  errors: DocumentValidationError[];
  repaired: boolean;
}

export interface DocumentValidationError {
  code:
    | "MISSING_SHARED_TYPE"
    | "INVALID_BLOCK_STRUCTURE"
    | "ORPHAN_BLOCK"
    | "DUPLICATE_BLOCK_ORDER"
    | "UNKNOWN_CONTENT_TYPE"
    | "MISSING_BLOCK_MAP_KEY"
    | "INVALID_SUBDOCUMENT";
  blockId?: string;
  message: string;
  severity: "error" | "warning";
}

export function validateDocument(
  ydoc: Y.Doc,
  options?: { repair?: boolean },
): DocumentValidationResult {
  const errors: DocumentValidationError[] = [];
  const repair = options?.repair === true;
  let repaired = false;

  // Check 1: Shared type existence and correct constructor
  // Must check via the share map BEFORE calling getArray/getMap,
  // because Yjs throws if the name exists with a different constructor.
  const share = ydoc.share;
  const expectedTypes: Array<[string, typeof Y.Array | typeof Y.Map]> = [
    [BLOCK_ORDER, Y.Array],
    [BLOCKS, Y.Map],
    [APPS, Y.Map],
    [METADATA, Y.Map],
  ];

  for (const [name, expectedCtor] of expectedTypes) {
    const existing = share.get(name);
    if (!existing) {
      errors.push({
        code: "MISSING_SHARED_TYPE",
        message: `Shared type '${name}' is missing`,
        severity: "error",
      });
      continue;
    }
    if (!(existing instanceof expectedCtor)) {
      errors.push({
        code: "MISSING_SHARED_TYPE",
        message: `Shared type '${name}' exists but is not a ${expectedCtor.name}`,
        severity: "error",
      });
    }
  }

  if (errors.some((e) => e.code === "MISSING_SHARED_TYPE")) {
    return { valid: false, errors, repaired: false };
  }

  // Safe to call getArray/getMap now — types are either absent (lazy-created)
  // or confirmed to be the correct constructor.
  const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
  const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
  const apps = ydoc.getMap(APPS);
  const metadata = ydoc.getMap(METADATA);

  // Check 2: Block structure integrity
  for (const [blockId, blockMap] of blocks.entries()) {
    const block = blockMap as Y.Map<unknown>;

    if (!block.has("type") || typeof block.get("type") !== "string") {
      errors.push({
        code: "MISSING_BLOCK_MAP_KEY",
        blockId,
        message: `Block '${blockId}' is missing a valid 'type' key`,
        severity: "error",
      });
      continue;
    }

    if (!block.has("props") || !(block.get("props") instanceof Y.Map)) {
      errors.push({
        code: "MISSING_BLOCK_MAP_KEY",
        blockId,
        message: `Block '${blockId}' is missing a valid 'props' Y.Map`,
        severity: "error",
      });
    }

    if (!block.has("meta") || !(block.get("meta") instanceof Y.Map)) {
      errors.push({
        code: "MISSING_BLOCK_MAP_KEY",
        blockId,
        message: `Block '${blockId}' is missing a valid 'meta' Y.Map`,
        severity: "error",
      });
    }

    const hasContent = block.has("content");
    const hasTable = block.has("tableContent");
    const hasChildren = block.has("children");
    const hasSubdocument = block.has(SUBDOCUMENT);
    const contentKeyCount =
      (hasContent ? 1 : 0) +
      (hasTable ? 1 : 0) +
      (hasChildren ? 1 : 0) +
      (hasSubdocument ? 1 : 0);

    if (contentKeyCount > 1) {
      errors.push({
        code: "INVALID_BLOCK_STRUCTURE",
        blockId,
        message: `Block '${blockId}' has ${contentKeyCount} content keys (should have at most 1)`,
        severity: "error",
      });
    }

    if (hasContent && !(block.get("content") instanceof Y.Text)) {
      errors.push({
        code: "UNKNOWN_CONTENT_TYPE",
        blockId,
        message: `Block '${blockId}' has 'content' but it is not a Y.Text`,
        severity: "error",
      });
    }

    if (hasTable && !(block.get("tableContent") instanceof Y.Array)) {
      errors.push({
        code: "UNKNOWN_CONTENT_TYPE",
        blockId,
        message: `Block '${blockId}' has 'tableContent' but it is not a Y.Array`,
        severity: "error",
      });
    }

    if (hasChildren && !(block.get("children") instanceof Y.Array)) {
      errors.push({
        code: "UNKNOWN_CONTENT_TYPE",
        blockId,
        message: `Block '${blockId}' has 'children' but it is not a Y.Array`,
        severity: "error",
      });
    }

    if (hasSubdocument && !(block.get(SUBDOCUMENT) instanceof Y.Doc)) {
      errors.push({
        code: "INVALID_SUBDOCUMENT",
        blockId,
        message: `Block '${blockId}' has '${SUBDOCUMENT}' but it is not a Y.Doc`,
        severity: "error",
      });
    }
  }

  // Check 3: blockOrder / blocks consistency
  const orderArr = blockOrder.toArray();
  const blockIds = new Set<string>();
  for (const [id] of blocks.entries()) {
    blockIds.add(id);
  }

  // 3a: Duplicates in blockOrder
  const seen = new Set<string>();
  const duplicateIndices: number[] = [];
  for (let i = 0; i < orderArr.length; i++) {
    if (seen.has(orderArr[i])) {
      duplicateIndices.push(i);
      errors.push({
        code: "DUPLICATE_BLOCK_ORDER",
        blockId: orderArr[i],
        message: `Block '${orderArr[i]}' appears multiple times in blockOrder`,
        severity: "warning",
      });
    }
    seen.add(orderArr[i]);
  }

  if (repair && duplicateIndices.length > 0) {
    ydoc.transact(() => {
      // Remove duplicates in reverse order to maintain indices
      for (let i = duplicateIndices.length - 1; i >= 0; i--) {
        blockOrder.delete(duplicateIndices[i], 1);
      }
    }, "system");
    repaired = true;
  }

  // 3b: Dangling references (in blockOrder but not blocks)
  const currentOrder = blockOrder.toArray();
  const danglingIndices: number[] = [];
  for (let i = 0; i < currentOrder.length; i++) {
    if (!blockIds.has(currentOrder[i])) {
      danglingIndices.push(i);
      errors.push({
        code: "ORPHAN_BLOCK",
        blockId: currentOrder[i],
        message: `Block '${currentOrder[i]}' is in blockOrder but not in blocks map`,
        severity: "warning",
      });
    }
  }

  if (repair && danglingIndices.length > 0) {
    ydoc.transact(() => {
      for (let i = danglingIndices.length - 1; i >= 0; i--) {
        blockOrder.delete(danglingIndices[i], 1);
      }
    }, "system");
    repaired = true;
  }

  // 3c: Orphans (in blocks but not blockOrder)
  const orderSet = new Set(blockOrder.toArray());
  const orphanIds: string[] = [];
  for (const id of blockIds) {
    if (!orderSet.has(id)) {
      orphanIds.push(id);
      errors.push({
        code: "ORPHAN_BLOCK",
        blockId: id,
        message: `Block '${id}' is in blocks map but not in blockOrder`,
        severity: "warning",
      });
    }
  }

  if (repair && orphanIds.length > 0) {
    ydoc.transact(() => {
      blockOrder.push(orphanIds);
    }, "system");
    repaired = true;
  }

  const hasErrors = errors.some((e) => e.severity === "error");
  return { valid: !hasErrors, errors, repaired };
}

// ── Document Creation ───────────────────────────────────────

export interface YjsDocumentOptions {
  gc?: boolean;
}

function normalizeDocumentProfile(value: unknown): DocumentProfile | null {
  return value === "structured" || value === "flow" ? value : null;
}

export function getDocumentProfile(doc: CRDTDocument): DocumentProfile | null {
  const value = asYjsDoc(doc).penDocument.metadata.get(DOCUMENT_PROFILE);
  return normalizeDocumentProfile(value);
}

export function setDocumentProfile(
  doc: CRDTDocument,
  profile: DocumentProfile,
): void {
  asYjsDoc(doc).penDocument.metadata.set(DOCUMENT_PROFILE, profile);
}

export function createYjsDocument(
  adapter: CRDTAdapter,
  options?: YjsDocumentOptions,
): YjsCRDTDocument {
  // Reliable block undo/redo requires deleted Yjs content to remain restorable.
  // Yjs recommends disabling GC when version/history restoration matters.
  const ydoc = new Y.Doc({ gc: options?.gc ?? false });
  const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
  const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
  const apps = ydoc.getMap<Y.Map<unknown>>(APPS);
  const metadata = ydoc.getMap(METADATA);

  const penDocument: YjsPenDocument = {
    blockOrder,
    blocks,
    apps,
    metadata,
    adapter,
  };

  return { adapter, ydoc, penDocument };
}

export function wrapYjsDocument(
  adapter: CRDTAdapter,
  ydoc: Y.Doc,
): YjsCRDTDocument {
  const blockOrder = ydoc.getArray<string>(BLOCK_ORDER);
  const blocks = ydoc.getMap<Y.Map<unknown>>(BLOCKS);
  const apps = ydoc.getMap<Y.Map<unknown>>(APPS);
  const metadata = ydoc.getMap(METADATA);

  const penDocument: YjsPenDocument = {
    blockOrder,
    blocks,
    apps,
    metadata,
    adapter,
  };

  return { adapter, ydoc, penDocument };
}

// ── Table Helpers ───────────────────────────────────────────

const DEFAULT_TABLE_ROWS = 2;
const DEFAULT_TABLE_COLS = 2;

export function createTableCell(): Y.Map<unknown> {
  const cell = new Y.Map<unknown>();
  cell.set("id", generateId());
  cell.set("content", new Y.Text());
  return cell;
}

export function createTableRow(colCount: number): Y.Map<unknown> {
  const row = new Y.Map<unknown>();
  row.set("id", generateId());
  const cells = new Y.Array<Y.Map<unknown>>();
  for (let c = 0; c < colCount; c++) {
    cells.push([createTableCell()]);
  }
  row.set("cells", cells);
  return row;
}

export function seedTableContent(
  tableContent: Y.Array<Y.Map<unknown>>,
  rows: number = DEFAULT_TABLE_ROWS,
  cols: number = DEFAULT_TABLE_COLS,
): void {
  for (let r = 0; r < rows; r++) {
    tableContent.push([createTableRow(cols)]);
  }
}

// ── Block Factory ───────────────────────────────────────────

export function initBlockMap(
  blocks: Y.Map<Y.Map<unknown>>,
  blockId: string,
  blockType: string,
  contentType: BlockContentType = "inline",
): Y.Map<unknown> {
  const blockMap = new Y.Map<unknown>();
  blockMap.set("type", blockType);
  blockMap.set("props", new Y.Map<unknown>());
  blockMap.set("meta", new Y.Map<unknown>());
  const parentDoc = (blocks as Y.Map<Y.Map<unknown>> & { doc?: Y.Doc | null }).doc;

  switch (contentType) {
    case "inline":
      blockMap.set("content", new Y.Text());
      break;
    case "table": {
      const tableContent = new Y.Array<Y.Map<unknown>>();
      seedTableContent(tableContent);
      blockMap.set("tableContent", tableContent);
      break;
    }
    case "database": {
      blockMap.set("tableContent", new Y.Array<Y.Map<unknown>>());
      blockMap.set("tableColumns", new Y.Array<Y.Map<unknown>>());
      blockMap.set("databaseViews", new Y.Array<Y.Map<unknown>>());
      break;
    }
    case "subdocument":
      blockMap.set(
        SUBDOCUMENT,
        parentDoc ? createYjsSubdocument(parentDoc) : new Y.Doc({ autoLoad: true }),
      );
      break;
    case "nested":
      blockMap.set("children", new Y.Array<string>());
      break;
    case "none":
      break;
  }

  blocks.set(blockId, blockMap);
  return blockMap;
}

// ── Type Guard ──────────────────────────────────────────────

export function isYjsCRDTDocument(
  doc: unknown,
): doc is YjsCRDTDocument {
  return (
    doc != null &&
    typeof doc === "object" &&
    "ydoc" in doc &&
    (doc as Record<string, unknown>).ydoc instanceof Y.Doc
  );
}
