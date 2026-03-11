import { describe, expect, it } from "vitest";
import * as Y from "yjs";

import {
  APPS,
  BLOCKS,
  BLOCK_ORDER,
  DOCUMENT_PROFILE,
  METADATA,
  SUBDOCUMENT,
  createYjsDocument,
  getDocumentProfile,
  initBlockMap,
  isYjsCRDTDocument,
  setDocumentProfile,
  validateDocument,
  wrapYjsDocument,
  createTableCell,
  createTableRow,
  seedTableContent,
} from "../document";
import { yjsAdapter } from "../adapter";

describe("document", () => {
  const adapter = yjsAdapter();

  describe("createYjsDocument", () => {
    it("creates a document with all four shared types", () => {
      const doc = createYjsDocument(adapter);
      expect(doc.ydoc).toBeInstanceOf(Y.Doc);
      expect(doc.penDocument.blockOrder).toBeInstanceOf(Y.Array);
      expect(doc.penDocument.blocks).toBeInstanceOf(Y.Map);
      expect(doc.penDocument.apps).toBeInstanceOf(Y.Map);
      expect(doc.penDocument.metadata).toBeInstanceOf(Y.Map);
      expect(doc.adapter).toBe(adapter);
    });

    it("defaults gc to false for reliable history restoration", () => {
      const doc = createYjsDocument(adapter);
      expect(doc.ydoc.gc).toBe(false);
    });

    it("respects gc: false option", () => {
      const doc = createYjsDocument(adapter, { gc: false });
      expect(doc.ydoc.gc).toBe(false);
    });

    it("starts without a persisted document profile", () => {
      const doc = createYjsDocument(adapter);
      expect(doc.penDocument.metadata.get(DOCUMENT_PROFILE)).toBeUndefined();
      expect(getDocumentProfile(doc)).toBeNull();
    });
  });

  describe("wrapYjsDocument", () => {
    it("wraps an existing Y.Doc", () => {
      const ydoc = new Y.Doc();
      ydoc.getArray(BLOCK_ORDER);
      ydoc.getMap(BLOCKS);
      ydoc.getMap(APPS);
      ydoc.getMap(METADATA);

      const doc = wrapYjsDocument(adapter, ydoc);
      expect(doc.ydoc).toBe(ydoc);
      expect(doc.penDocument.blockOrder).toBeInstanceOf(Y.Array);
      expect(doc.penDocument.blocks).toBeInstanceOf(Y.Map);
    });
  });

  describe("initBlockMap", () => {
    it("creates inline block with Y.Text content", () => {
      const doc = createYjsDocument(adapter);
      doc.ydoc.transact(() => {
        initBlockMap(doc.penDocument.blocks, "b1", "paragraph", "inline");
      });

      const block = doc.penDocument.blocks.get("b1")!;
      expect(block.get("type")).toBe("paragraph");
      expect(block.get("props")).toBeInstanceOf(Y.Map);
      expect(block.get("content")).toBeInstanceOf(Y.Text);
      expect(block.get("meta")).toBeInstanceOf(Y.Map);
      expect(block.has("children")).toBe(false);
      expect(block.has("tableContent")).toBe(false);
    });

    it("creates table block with seeded 2x2 tableContent", () => {
      const doc = createYjsDocument(adapter);
      doc.ydoc.transact(() => {
        initBlockMap(doc.penDocument.blocks, "b2", "table", "table");
      });

      const block = doc.penDocument.blocks.get("b2")!;
      expect(block.get("type")).toBe("table");
      const tableContent = block.get("tableContent") as Y.Array<Y.Map<unknown>>;
      expect(tableContent).toBeInstanceOf(Y.Array);
      expect(tableContent.length).toBe(2);

      const row0 = tableContent.get(0);
      expect(row0.get("id")).toEqual(expect.any(String));
      const cells0 = row0.get("cells") as Y.Array<Y.Map<unknown>>;
      expect(cells0).toBeInstanceOf(Y.Array);
      expect(cells0.length).toBe(2);

      const cell00 = cells0.get(0);
      expect(cell00.get("id")).toEqual(expect.any(String));
      expect(cell00.get("content")).toBeInstanceOf(Y.Text);

      expect(block.has("content")).toBe(false);
      expect(block.has("children")).toBe(false);
    });

    it("creates nested block with Y.Array children", () => {
      const doc = createYjsDocument(adapter);
      doc.ydoc.transact(() => {
        initBlockMap(doc.penDocument.blocks, "b3", "section", "nested");
      });

      const block = doc.penDocument.blocks.get("b3")!;
      expect(block.get("children")).toBeInstanceOf(Y.Array);
      expect(block.has("content")).toBe(false);
      expect(block.has("tableContent")).toBe(false);
    });

    it("creates subdocument blocks with a nested Y.Doc", () => {
      const doc = createYjsDocument(adapter);
      doc.ydoc.transact(() => {
        initBlockMap(doc.penDocument.blocks, "b-sub", "subdocument", "subdocument");
      });

      const block = doc.penDocument.blocks.get("b-sub")!;
      const subdoc = block.get(SUBDOCUMENT) as Y.Doc;
      expect(subdoc).toBeInstanceOf(Y.Doc);
      expect(subdoc.gc).toBe(doc.ydoc.gc);
      expect(block.has("content")).toBe(false);
      expect(block.has("children")).toBe(false);
      expect(block.has("tableContent")).toBe(false);
    });

    it("creates block with content type 'none'", () => {
      const doc = createYjsDocument(adapter);
      doc.ydoc.transact(() => {
        initBlockMap(doc.penDocument.blocks, "b4", "divider", "none");
      });

      const block = doc.penDocument.blocks.get("b4")!;
      expect(block.get("type")).toBe("divider");
      expect(block.get("props")).toBeInstanceOf(Y.Map);
      expect(block.get("meta")).toBeInstanceOf(Y.Map);
      expect(block.has("content")).toBe(false);
      expect(block.has("children")).toBe(false);
      expect(block.has("tableContent")).toBe(false);
    });

    it("defaults content type to inline", () => {
      const doc = createYjsDocument(adapter);
      doc.ydoc.transact(() => {
        initBlockMap(doc.penDocument.blocks, "b5", "paragraph");
      });

      const block = doc.penDocument.blocks.get("b5")!;
      expect(block.get("content")).toBeInstanceOf(Y.Text);
    });
  });

  describe("isYjsCRDTDocument", () => {
    it("returns true for adapter-created docs", () => {
      const doc = createYjsDocument(adapter);
      expect(isYjsCRDTDocument(doc)).toBe(true);
    });

    it("returns false for plain objects", () => {
      expect(isYjsCRDTDocument({})).toBe(false);
      expect(isYjsCRDTDocument(null)).toBe(false);
      expect(isYjsCRDTDocument({ ydoc: "not a doc" })).toBe(false);
    });
  });

  describe("constants", () => {
    it("exports correct shared type key names", () => {
      expect(BLOCK_ORDER).toBe("blockOrder");
      expect(BLOCKS).toBe("blocks");
      expect(APPS).toBe("apps");
      expect(METADATA).toBe("metadata");
      expect(DOCUMENT_PROFILE).toBe("documentProfile");
    });
  });

  describe("document profile helpers", () => {
    it("updates document profile metadata", () => {
      const doc = createYjsDocument(adapter);
      setDocumentProfile(doc, "flow");
      expect(getDocumentProfile(doc)).toBe("flow");
      expect(doc.penDocument.metadata.get(DOCUMENT_PROFILE)).toBe("flow");
    });
  });

  describe("validateDocument", () => {
    it("fails when required shared roots are missing", () => {
      const ydoc = new Y.Doc();
      ydoc.getMap(BLOCKS);
      ydoc.getMap(APPS);

      const validation = validateDocument(ydoc);

      expect(validation.valid).toBe(false);
      expect(validation.errors).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "MISSING_SHARED_TYPE",
            message: "Shared type 'blockOrder' is missing",
          }),
          expect.objectContaining({
            code: "MISSING_SHARED_TYPE",
            message: "Shared type 'metadata' is missing",
          }),
        ]),
      );
    });
  });

  describe("table helpers", () => {
    it("createTableCell returns a Y.Map with id and content when integrated", () => {
      const doc = createYjsDocument(adapter);
      const container = new Y.Array<Y.Map<unknown>>();
      doc.ydoc.transact(() => {
        doc.ydoc.getMap("_test").set("container", container);
        container.push([createTableCell()]);
      });
      const cell = container.get(0);
      expect(cell.get("id")).toEqual(expect.any(String));
      expect(cell.get("content")).toBeInstanceOf(Y.Text);
    });

    it("createTableRow returns a Y.Map with id and cells array when integrated", () => {
      const doc = createYjsDocument(adapter);
      const container = new Y.Array<Y.Map<unknown>>();
      doc.ydoc.transact(() => {
        doc.ydoc.getMap("_test").set("container", container);
        container.push([createTableRow(3)]);
      });
      const row = container.get(0);
      expect(row.get("id")).toEqual(expect.any(String));
      const cells = row.get("cells") as Y.Array<Y.Map<unknown>>;
      expect(cells).toBeInstanceOf(Y.Array);
      expect(cells.length).toBe(3);
      for (let i = 0; i < 3; i++) {
        expect(cells.get(i).get("content")).toBeInstanceOf(Y.Text);
      }
    });

    it("seedTableContent populates with given dimensions", () => {
      const doc = createYjsDocument(adapter);
      const tc = new Y.Array<Y.Map<unknown>>();
      doc.ydoc.transact(() => {
        doc.ydoc.getMap("_test").set("tc", tc);
        seedTableContent(tc, 3, 4);
      });
      expect(tc.length).toBe(3);
      for (let r = 0; r < 3; r++) {
        const row = tc.get(r);
        const cells = row.get("cells") as Y.Array<Y.Map<unknown>>;
        expect(cells.length).toBe(4);
      }
    });

    it("seedTableContent defaults to 2x2", () => {
      const doc = createYjsDocument(adapter);
      const tc = new Y.Array<Y.Map<unknown>>();
      doc.ydoc.transact(() => {
        doc.ydoc.getMap("_test").set("tc", tc);
        seedTableContent(tc);
      });
      expect(tc.length).toBe(2);
      const cells = (tc.get(0).get("cells") as Y.Array<Y.Map<unknown>>);
      expect(cells.length).toBe(2);
    });

    it("each cell id is unique", () => {
      const doc = createYjsDocument(adapter);
      const tc = new Y.Array<Y.Map<unknown>>();
      doc.ydoc.transact(() => {
        doc.ydoc.getMap("_test").set("tc", tc);
        seedTableContent(tc, 2, 2);
      });
      const ids = new Set<string>();
      for (let r = 0; r < 2; r++) {
        const row = tc.get(r);
        ids.add(row.get("id") as string);
        const cells = row.get("cells") as Y.Array<Y.Map<unknown>>;
        for (let c = 0; c < 2; c++) {
          ids.add(cells.get(c).get("id") as string);
        }
      }
      expect(ids.size).toBe(6);
    });

    it("initBlockMap seeds table blocks with 2x2 grid", () => {
      const doc = createYjsDocument(adapter);
      doc.ydoc.transact(() => {
        initBlockMap(doc.penDocument.blocks, "t1", "table", "table");
      });

      const block = doc.penDocument.blocks.get("t1")!;
      const tc = block.get("tableContent") as Y.Array<Y.Map<unknown>>;
      expect(tc.length).toBe(2);
      const row0 = tc.get(0);
      expect(row0.get("id")).toEqual(expect.any(String));
      const cells0 = row0.get("cells") as Y.Array<Y.Map<unknown>>;
      expect(cells0.length).toBe(2);
      expect(cells0.get(0).get("content")).toBeInstanceOf(Y.Text);
    });
  });
});
