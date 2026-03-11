import { describe, expect, it } from "vitest";
import { processStream } from "@pen/delta-stream";
import { inputRulesExtension } from "@pen/input-rules";
import { yjsAdapter } from "@pen/crdt-yjs";
import type { PenStreamPart } from "@pen/types";

import { createDocumentSession, createEditor, defineExtension } from "../index";

async function* createStream(parts: PenStreamPart[]) {
	for (const part of parts) {
		yield part;
	}
}

async function flushMicrotasks(count = 2): Promise<void> {
	for (let index = 0; index < count; index++) {
		await Promise.resolve();
	}
}

function visibleText(text: string): string {
	return text.replace(/\u200B/g, "");
}

describe("@pen/core createEditor", () => {
	it("supports multiple editors sharing one document session", () => {
		const session = createDocumentSession({
			adapter: yjsAdapter(),
		});
		const editorA = createEditor({
			documentSession: session,
			without: ["document-ops", "delta-stream", "undo"],
		});
		const editorB = createEditor({
			documentSession: session,
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editorA.firstBlock()!.id;

		editorA.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "Shared",
			},
		]);

		expect(editorB.getBlock(blockId)?.textContent()).toBe("Shared");
		expect(editorA.documentScope.id).toBe(editorB.documentScope.id);
		expect(editorA.internals.documentSession).toBe(session);
		expect(editorB.internals.documentSession).toBe(session);

		editorA.destroy();
		editorB.apply([
			{
				type: "insert-text",
				blockId,
				offset: 6,
				text: " doc",
			},
		]);

		expect(editorB.getBlock(blockId)?.textContent()).toBe("Shared doc");

		editorB.destroy();
		session.destroy();
	});

	it("does not destroy caller-owned documents on editor teardown", () => {
		const adapter = yjsAdapter();
		const document = adapter.createDocument();
		const editorA = createEditor({
			document,
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editorA.firstBlock()!.id;

		editorA.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "Persisted",
			},
		]);
		editorA.destroy();

		const editorB = createEditor({
			document,
			without: ["document-ops", "delta-stream", "undo"],
		});

		expect(editorB.getBlock(blockId)?.textContent()).toBe("Persisted");

		editorB.destroy();
	});

	it("persists document profile metadata for new editors", () => {
		const editor = createEditor({
			documentProfile: "flow",
			without: ["document-ops", "delta-stream", "undo"],
		});

		expect(editor.documentProfile).toBe("flow");
		expect(editor.documentState.documentProfile).toBe("flow");
		expect(editor.editorViewMode).toBe("flow");
		expect(
			editor.internals.adapter.getDocumentProfile?.(editor.internals.crdtDoc),
		).toBe("flow");

		editor.destroy();
	});

	it("loads persisted document profile independently from local editor view mode", () => {
		const adapter = yjsAdapter();
		const document = adapter.createDocument();
		adapter.setDocumentProfile?.(document, "flow");

		const editor = createEditor({
			document,
			editorViewMode: "structured",
			without: ["document-ops", "delta-stream", "undo"],
		});

		expect(editor.documentProfile).toBe("flow");
		expect(editor.documentState.documentProfile).toBe("flow");
		expect(editor.editorViewMode).toBe("structured");

		editor.destroy();
	});

	it("keeps document profile in sync with persisted metadata changes", () => {
		const adapter = yjsAdapter();
		const document = adapter.createDocument();
		const editor = createEditor({
			document,
			without: ["document-ops", "delta-stream", "undo"],
		});

		expect(editor.documentProfile).toBe("structured");
		expect(editor.documentState.documentProfile).toBe("structured");

		adapter.setDocumentProfile?.(document, "flow");

		expect(editor.documentProfile).toBe("flow");
		expect(editor.documentState.documentProfile).toBe("flow");
		expect(editor.editorViewMode).toBe("flow");

		editor.destroy();
	});

	it("drops flow-disallowed block insertions at the mutation boundary", () => {
		const editor = createEditor({
			documentProfile: "flow",
			without: ["document-ops", "delta-stream", "undo"],
		});
		const diagnostics: unknown[] = [];

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "db1",
				blockType: "database",
				props: {},
				position: "last",
			},
		]);

		expect(editor.getBlock("db1")).toBeNull();
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_PROFILE_001",
				level: "warn",
				source: "profile-policy",
				blockType: "database",
				documentProfile: "flow",
			}),
		);

		editor.destroy();
	});

	it("re-applies the flow mutation boundary after extension hooks run", () => {
		const editor = createEditor({
			documentProfile: "flow",
			without: ["document-ops", "delta-stream", "undo"],
		});
		const diagnostics: unknown[] = [];

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.onBeforeApply(
			(ops) => [
				...ops,
				{
					type: "insert-block",
					blockId: "db-after-hook",
					blockType: "database",
					props: {},
					position: "last",
				},
			],
			{ priority: 20000 },
		);

		editor.apply([
			{
				type: "insert-block",
				blockId: "p-after-hook",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		expect(editor.getBlock("p-after-hook")?.type).toBe("paragraph");
		expect(editor.getBlock("db-after-hook")).toBeNull();
		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_PROFILE_001",
				blockType: "database",
				documentProfile: "flow",
			}),
		);

		editor.destroy();
	});

	it("drops flow-disallowed block conversions at the mutation boundary", () => {
		const editor = createEditor({
			documentProfile: "flow",
			without: ["document-ops", "delta-stream", "undo"],
		});
		const firstBlockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: "Hello",
			},
		]);

		editor.apply([
			{
				type: "convert-block",
				blockId: firstBlockId,
				newType: "database",
				newProps: {},
			},
		]);

		expect(editor.getBlock(firstBlockId)?.type).toBe("paragraph");
		expect(editor.getBlock(firstBlockId)?.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("still allows optional structural blocks in flow documents", () => {
		const editor = createEditor({
			documentProfile: "flow",
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "table1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		expect(editor.getBlock("table1")?.type).toBe("table");

		editor.destroy();
	});

	it("discovers subdocument scopes and lets nested editors edit them", () => {
		const session = createDocumentSession({
			adapter: yjsAdapter(),
		});
		const rootEditor = createEditor({
			documentSession: session,
			without: ["document-ops", "delta-stream", "undo"],
		});

		rootEditor.apply([
			{
				type: "insert-block",
				blockId: "subdoc-block",
				blockType: "subdocument",
				props: { title: "Nested" },
				position: "last",
			},
		]);

		const childScope = session.getScopeForBlock("subdoc-block", {
			scopeId: rootEditor.documentScope.id,
		});
		expect(childScope).not.toBeNull();
		expect(rootEditor.getBlock("subdoc-block")?.props.subdocumentGuid).toBe(
			childScope?.guid,
		);

		const childEditor = createEditor({
			documentSession: session,
			documentScopeId: childScope!.id,
			without: ["document-ops", "delta-stream", "undo"],
		});
		const childBlockId = childEditor.firstBlock()!.id;

		childEditor.apply([
			{
				type: "insert-text",
				blockId: childBlockId,
				offset: 0,
				text: "Nested content",
			},
		]);

		expect(childEditor.getBlock(childBlockId)?.textContent()).toBe(
			"Nested content",
		);
		expect(childEditor.documentScope.parentId).toBe(rootEditor.documentScope.id);
		expect(childEditor.documentScope.ownerBlockId).toBe("subdoc-block");

		childEditor.apply([
			{
				type: "insert-block",
				blockId: "subdoc-block",
				blockType: "subdocument",
				props: { title: "Nested Nested" },
				position: "last",
			},
		]);

		const nestedScope = session.getScopeForBlock("subdoc-block", {
			scopeId: childEditor.documentScope.id,
		});
		expect(nestedScope).not.toBeNull();
		expect(nestedScope?.id).not.toBe(childScope?.id);
		expect(session.getScopeForBlock("subdoc-block")).toBeNull();

		childEditor.destroy();
		rootEditor.destroy();
		session.destroy();
	});

	it("creates a working editor with default schema and extensions", () => {
		const editor = createEditor();

		expect(editor.schema.resolve("paragraph")).toBeTruthy();
		expect(typeof editor.clientId).toBe("number");
		expect(editor.internals.getSlot("core:engine")).toBe(
			editor.internals.engine,
		);
		expect(
			editor.internals.getSlot("document-ops:toolServer"),
		).toBeTruthy();
		expect(editor.internals.getSlot("undo:manager")).toBeTruthy();

		editor.destroy();
	});

	it("starts with a single empty paragraph block in zero-config mode", () => {
		const editor = createEditor();

		expect(editor.blockCount()).toBe(1);
		expect(editor.firstBlock()?.type).toBe("paragraph");
		expect(editor.firstBlock()?.textContent()).toBe("");

		editor.destroy();
	});

	it("applies insert-block and insert-text operations", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "insert-text",
				blockId: "b1",
				offset: 0,
				text: "hello",
			},
		]);

		expect(editor.getBlock("b1")?.textContent()).toBe("hello");

		editor.destroy();
	});

	it("splits and merges inline blocks", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-text",
				blockId: "b1",
				offset: 0,
				text: "hello world",
			},
		]);

		editor.apply([
			{
				type: "split-block",
				blockId: "b1",
				offset: 5,
				newBlockId: "b2",
			},
		]);

		expect(editor.getBlock("b1")?.textContent()).toBe("hello");
		expect(editor.getBlock("b2")?.textContent()).toBe(" world");

		editor.apply([
			{
				type: "merge-blocks",
				targetBlockId: "b1",
				sourceBlockId: "b2",
			},
		]);

		expect(editor.getBlock("b1")?.textContent()).toBe("hello world");
		expect(editor.getBlock("b2")).toBeNull();

		editor.destroy();
	});

	it("preserves full text offsets for code blocks", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "codeBlock" },
			{ type: "insert-text", blockId, offset: 0, text: "abcd" },
		]);

		editor.selectTextRange(
			{ blockId, offset: 1 },
			{ blockId, offset: 3 },
		);

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 3 },
		});
		expect(editor.getSelectedText()).toBe("bc");

		editor.destroy();
	});

	it("clears stale grid state when converting table or database blocks", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "table-block",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "database-block",
				blockType: "database",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "database-insert-row",
				blockId: "database-block",
				rowId: "row-1",
				values: {
					name: "Alpha",
					tags: "todo",
					status: "true",
				},
			},
			{
				type: "convert-block",
				blockId: "table-block",
				newType: "paragraph",
			},
			{
				type: "convert-block",
				blockId: "database-block",
				newType: "paragraph",
			},
		]);

		const tableBlock = editor.getBlock("table-block")!;
		const databaseBlock = editor.getBlock("database-block")!;
		expect(tableBlock.type).toBe("paragraph");
		expect(tableBlock.tableRowCount()).toBe(0);
		expect(tableBlock.tableColumns()).toEqual([]);
		expect(tableBlock.databaseViews()).toEqual([]);

		expect(databaseBlock.type).toBe("paragraph");
		expect(databaseBlock.tableRowCount()).toBe(0);
		expect(databaseBlock.tableColumns()).toEqual([]);
		expect(databaseBlock.databaseViews()).toEqual([]);
		expect(databaseBlock.databasePrimaryViewId()).toBeNull();

		const tableBlockMap = (editor.internals.doc.blocks as any).get("table-block");
		const databaseBlockMap = (editor.internals.doc.blocks as any).get("database-block");
		expect(tableBlockMap.get("tableContent")).toBeUndefined();
		expect(tableBlockMap.get("tableColumns")).toBeUndefined();
		expect(tableBlockMap.get("databaseViews")).toBeUndefined();
		expect(tableBlockMap.get("databasePrimaryViewId")).toBeUndefined();
		expect(databaseBlockMap.get("tableContent")).toBeUndefined();
		expect(databaseBlockMap.get("tableColumns")).toBeUndefined();
		expect(databaseBlockMap.get("databaseViews")).toBeUndefined();
		expect(databaseBlockMap.get("databasePrimaryViewId")).toBeUndefined();

		editor.destroy();
	});

	it("queues reentrant apply calls from observe hooks", () => {
		let appended = false;
		const ext = defineExtension({
			name: "append-exclamation",
			observe(events, editor) {
				if (appended) return;
				const hasInsertText = events.some((event) =>
					event.ops.some((op) => op.type === "insert-text"),
				);
				if (!hasInsertText) return;

				appended = true;
				editor.apply(
					[
						{
							type: "insert-text",
							blockId: "b1",
							offset: 5,
							text: "!",
						},
					],
					{ origin: "extension" },
				);
			},
		});

		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
			extensions: [ext],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-text",
				blockId: "b1",
				offset: 0,
				text: "hello",
			},
		]);

		expect(editor.getBlock("b1")?.textContent()).toBe("hello!");

		editor.destroy();
	});

	it("activates input-rules extensions and applies block conversions", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
			extensions: [inputRulesExtension()],
		});
		const blockId = editor.firstBlock()!.id;

		editor.selectTextRange(
			{ blockId, offset: 0 },
			{ blockId, offset: 0 },
		);

		editor.apply(
			[
				{
					type: "insert-text",
					blockId,
					offset: 0,
					text: "#",
				},
			],
			{ origin: "user" },
		);
		editor.selectTextRange(
			{ blockId, offset: 1 },
			{ blockId, offset: 1 },
		);
		editor.apply(
			[
				{
					type: "insert-text",
					blockId,
					offset: 1,
					text: " ",
				},
			],
			{ origin: "user" },
		);
		await flushMicrotasks();

		expect(editor.getBlock(blockId)?.type).toBe("heading");
		expect(editor.getBlock(blockId)?.props.level).toBe(1);
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		editor.destroy();
	});

	it("activates input-rules extensions and applies inline markdown conversions", async () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
			extensions: [inputRulesExtension()],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply(
			[
				{
					type: "insert-text",
					blockId,
					offset: 0,
					text: "**hello*",
				},
			],
			{ origin: "user" },
		);
		editor.apply(
			[
				{
					type: "insert-text",
					blockId,
					offset: 8,
					text: "*",
				},
			],
			{ origin: "user" },
		);
		await flushMicrotasks();

		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("hello");
		expect(editor.getBlock(blockId)?.textDeltas()).toEqual([
			{
				insert: "hello",
				attributes: { bold: true },
			},
		]);

		editor.destroy();
	});

	it("emits unified change and documentCommit once for a local apply batch", () => {
		const observed: unknown[][] = [];
		const ext = defineExtension({
			name: "capture-local-dispatch",
			observe(events) {
				observed.push(events);
			},
		});
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
			extensions: [ext],
		});
		const changes: unknown[][] = [];
		const documentCommits: unknown[] = [];
		const blockId = editor.firstBlock()!.id;

		editor.on("change", (events) => {
			changes.push(events);
		});
		editor.on("documentCommit", (event) => {
			documentCommits.push(event);
		});
		observed.length = 0;
		changes.length = 0;
		documentCommits.length = 0;

		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "hello",
			},
		]);

		expect(changes).toHaveLength(1);
		expect(changes[0]).toHaveLength(1);
		expect(changes[0][0]).toMatchObject({
			origin: "user",
			affectedBlocks: [blockId],
		});
		expect(documentCommits).toHaveLength(1);
		expect(documentCommits[0]).toMatchObject({
			commitId: 2,
			origin: "user",
			affectedBlocks: [blockId],
		});
		expect((documentCommits[0] as { blockRevisions: Record<string, number> }).blockRevisions[blockId]).toBe(
			editor.getBlockRevision(blockId),
		);
		expect(observed).toHaveLength(1);
		expect(observed[0]).toHaveLength(1);

		editor.destroy();
	});

	it("emits unified change and documentCommit once for observed CRDT updates", () => {
		const observed: unknown[][] = [];
		const ext = defineExtension({
			name: "capture-observed-dispatch",
			observe(events) {
				observed.push(events);
			},
		});
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
			extensions: [ext],
		});
		const changes: unknown[][] = [];
		const documentCommits: unknown[] = [];
		const adapter = editor.internals.adapter;
		const editorDoc = editor.internals.crdtDoc;
		const blockId = editor.firstBlock()!.id;
		const remoteDoc = adapter.loadDocument(adapter.encodeState(editorDoc));
		const remoteYDoc = adapter.raw<any>(remoteDoc);
		const remoteYText = remoteYDoc
			.getMap("blocks")
			.get(blockId)
			?.get("content");

		editor.on("change", (events) => {
			changes.push(events);
		});
		editor.on("documentCommit", (event) => {
			documentCommits.push(event);
		});
		observed.length = 0;
		changes.length = 0;
		documentCommits.length = 0;

		adapter.transact(
			remoteDoc,
			() => {
				remoteYText.insert(0, "remote ");
			},
			"collaborator",
		);
		adapter.applyUpdate(editorDoc, adapter.encodeState(remoteDoc));

		expect(changes).toHaveLength(1);
		expect(changes[0]).toHaveLength(1);
		expect(changes[0][0]).toMatchObject({
			affectedBlocks: [blockId],
		});
		expect(documentCommits).toHaveLength(1);
		expect(documentCommits[0]).toMatchObject({
			commitId: 2,
			affectedBlocks: [blockId],
		});
		expect((documentCommits[0] as { blockRevisions: Record<string, number> }).blockRevisions[blockId]).toBe(
			editor.getBlockRevision(blockId),
		);
		expect(observed).toHaveLength(1);
		expect(observed[0]).toHaveLength(1);

		editor.destroy();
	});

	it("clamps text selections and returns backwards selected text", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-text",
				blockId: "b1",
				offset: 0,
				text: "hello",
			},
		]);

		editor.selectText("b1", 10, 99);
		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "b1", offset: 5 },
			focus: { blockId: "b1", offset: 5 },
		});

		editor.setSelection({
			type: "text",
			anchor: { blockId: "b1", offset: 5 },
			focus: { blockId: "b1", offset: 2 },
			isCollapsed: false,
			isMultiBlock: false,
			blockRange: ["b1"],
			toRange: () => {
				throw new Error("test helper");
			},
		});

		expect(editor.getSelectedText()).toBe("llo");

		editor.destroy();
	});

	it("selects text ranges across blocks in document order", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{ type: "insert-text", blockId: "b1", offset: 0, text: "Hello" },
			{ type: "insert-text", blockId: "b2", offset: 0, text: "World" },
			{ type: "insert-text", blockId: "b3", offset: 0, text: "Again" },
		]);

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b3", offset: 3 },
		);

		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "b1", offset: 2 },
			focus: { blockId: "b3", offset: 3 },
			isMultiBlock: true,
			blockRange: ["b1", "b2", "b3"],
		});
		expect(editor.getSelectedText()).toBe("llo\nWorld\nAga");
		expect(editor.getSelectedBlocks().map((block) => block.id)).toEqual([
			"b1",
			"b2",
			"b3",
		]);

		editor.destroy();
	});

	it("deletes multi-block text selections and collapses at the start", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{ type: "insert-text", blockId: "b1", offset: 0, text: "Hello" },
			{ type: "insert-text", blockId: "b2", offset: 0, text: "World" },
			{ type: "insert-text", blockId: "b3", offset: 0, text: "Again" },
		]);

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b3", offset: 2 },
		);
		editor.deleteSelection();

		expect(editor.getBlock("b1")?.textContent()).toBe("Heain");
		expect(editor.getBlock("b2")).toBeNull();
		expect(editor.getBlock("b3")).toBeNull();
		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "b1", offset: 2 },
			focus: { blockId: "b1", offset: 2 },
			isMultiBlock: false,
			blockRange: ["b1"],
		});

		editor.destroy();
	});

	it("deletes a fully selected structural block", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "d1",
				blockType: "divider",
				props: {},
				position: "last",
			},
		]);

		editor.selectTextRange(
			{ blockId: "d1", offset: 0 },
			{ blockId: "d1", offset: 1 },
		);
		editor.deleteSelection();

		expect(editor.getBlock("d1")).toBeNull();
		expect(editor.getSelection()).toBeNull();

		editor.destroy();
	});

	it("deletes a fully selected delegated block", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.selectTextRange(
			{ blockId: "t1", offset: 0 },
			{ blockId: "t1", offset: 1 },
		);
		editor.deleteSelection();

		expect(editor.getBlock("t1")).toBeNull();
		expect(editor.getSelection()).toBeNull();

		editor.destroy();
	});

	it("deletes structural blocks at multi-block selection boundaries", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "p1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "d1",
				blockType: "divider",
				props: {},
				position: "last",
			},
			{ type: "insert-text", blockId: "p1", offset: 0, text: "Hello" },
		]);

		editor.selectTextRange(
			{ blockId: "p1", offset: 2 },
			{ blockId: "d1", offset: 1 },
		);
		editor.deleteSelection();

		expect(editor.getBlock("p1")?.textContent()).toBe("He");
		expect(editor.getBlock("d1")).toBeNull();
		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "p1", offset: 2 },
			focus: { blockId: "p1", offset: 2 },
			isMultiBlock: false,
			blockRange: ["p1"],
		});

		editor.destroy();
	});

	it("replaces multi-block text selections at a single insertion point", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{ type: "insert-text", blockId: "b1", offset: 0, text: "Hello" },
			{ type: "insert-text", blockId: "b2", offset: 0, text: "World" },
			{ type: "insert-text", blockId: "b3", offset: 0, text: "Again" },
		]);

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b3", offset: 2 },
		);
		editor.replaceSelection("X");

		expect(editor.getBlock("b1")?.textContent()).toBe("HeXain");
		expect(editor.getBlock("b2")).toBeNull();
		expect(editor.getBlock("b3")).toBeNull();
		expect(editor.getSelection()).toMatchObject({
			type: "text",
			anchor: { blockId: "b1", offset: 3 },
			focus: { blockId: "b1", offset: 3 },
			isMultiBlock: false,
			blockRange: ["b1"],
		});

		editor.destroy();
	});

	it("preserves formatted suffix text when deleting across blocks", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{ type: "insert-text", blockId: "b1", offset: 0, text: "Hello" },
			{ type: "insert-text", blockId: "b2", offset: 0, text: "Again" },
			{
				type: "format-text",
				blockId: "b2",
				offset: 2,
				length: 3,
				marks: { bold: true },
			},
		]);

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b2", offset: 2 },
		);
		editor.deleteSelection();

		expect(editor.getBlock("b1")?.textDeltas()).toEqual([
			{ insert: "He" },
			{
				insert: "ain",
				attributes: { bold: true },
			},
		]);
		expect(editor.getBlock("b2")).toBeNull();

		editor.destroy();
	});

	it("replaces multi-block text selections in a single document commit batch", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const events: Array<{ ops: readonly { type: string }[] }> = [];

		editor.on("documentCommit", (event) => {
			events.push(event as { ops: readonly { type: string }[] });
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b2",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "b3",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{ type: "insert-text", blockId: "b1", offset: 0, text: "Hello" },
			{ type: "insert-text", blockId: "b2", offset: 0, text: "World" },
			{ type: "insert-text", blockId: "b3", offset: 0, text: "Again" },
		]);
		events.length = 0;

		editor.selectTextRange(
			{ blockId: "b1", offset: 2 },
			{ blockId: "b3", offset: 2 },
		);
		editor.replaceSelection("X");

		expect(events).toHaveLength(1);
		expect(events[0]?.ops.map((op) => op.type)).toEqual([
			"delete-text",
			"delete-text",
			"delete-block",
			"insert-text",
			"insert-text",
			"delete-block",
		]);

		editor.destroy();
	});

	it("rebinds undo manager after loadDocument", () => {
		const editor = createEditor();
		const oldUndoManager = editor.undoManager;
		const newDoc = editor.internals.adapter.createDocument();

		editor.loadDocument(newDoc);

		expect(editor.undoManager).toBe(
			editor.internals.getSlot("undo:manager"),
		);
		expect(editor.undoManager).not.toBe(oldUndoManager);

		editor.destroy();
	});

	it("updates documentState parent relationships after parentId changes", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "parent",
				blockType: "toggle",
				props: {},
				position: "last",
			},
			{
				type: "insert-block",
				blockId: "child",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "update-block",
				blockId: "child",
				props: { parentId: "parent" },
			},
		]);

		expect(editor.documentState.parentOf("child")).toBe("parent");

		editor.apply([
			{
				type: "update-block",
				blockId: "child",
				props: { parentId: null },
			},
		]);

		expect(editor.documentState.parentOf("child")).toBeNull();

		editor.destroy();
	});

	it("emits structured diagnostics for unknown block types", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});
		const diagnostics: unknown[] = [];

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "unknown",
				blockType: "not-real",
				props: {},
				position: "last",
			},
		]);

		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_APPLY_002",
				level: "warn",
				source: "apply",
			}),
		);

		editor.destroy();
	});

	it("emits remediation text for extension observe failures", () => {
		const diagnostics: unknown[] = [];
		const ext = defineExtension({
			name: "broken-observe",
			observe() {
				throw new Error("boom");
			},
		});
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
			extensions: [ext],
		});

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_EXT_001",
				level: "error",
				source: "extension",
				remediation: expect.any(String),
			}),
		);

		editor.destroy();
	});

	it("processes streamed AI deltas through the default delta-stream pipeline", async () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		await processStream(
			createStream([
				{ type: "gen-start", zoneId: "zone-1", blockId },
				{ type: "gen-delta", zoneId: "zone-1", delta: "Hello " },
				{ type: "gen-delta", zoneId: "zone-1", delta: "world" },
				{ type: "gen-end", zoneId: "zone-1", status: "complete" },
			]),
			editor,
		);

		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"Hello world",
		);
		expect(
			editor.internals.getSlot<{ generationZone: unknown }>(
				"delta-stream:target",
			)?.generationZone ?? null,
		).toBeNull();

		editor.destroy();
	});

	it("keeps streamed AI generations in their own undo group", async () => {
		const editor = createEditor();
		const firstBlockId = editor.firstBlock()!.id;
		const secondBlockId = crypto.randomUUID();

		editor.apply(
			[
				{
					type: "insert-block",
					blockId: secondBlockId,
					blockType: "paragraph",
					props: {},
					position: "last",
				},
			],
			{ origin: "system" },
		);

		editor.apply(
			[
				{
					type: "insert-text",
					blockId: firstBlockId,
					offset: 0,
					text: "hello",
				},
			],
			{ origin: "user" },
		);

		await processStream(
			createStream([
				{ type: "gen-start", zoneId: "zone-2", blockId: secondBlockId },
				{ type: "gen-delta", zoneId: "zone-2", delta: "AI output" },
				{ type: "gen-end", zoneId: "zone-2", status: "complete" },
			]),
			editor,
		);

		expect(visibleText(editor.getBlock(firstBlockId)!.textContent())).toBe(
			"hello",
		);
		expect(visibleText(editor.getBlock(secondBlockId)!.textContent())).toBe(
			"AI output",
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(visibleText(editor.getBlock(firstBlockId)!.textContent())).toBe(
			"hello",
		);
		expect(visibleText(editor.getBlock(secondBlockId)!.textContent())).toBe(
			"",
		);

		expect(editor.undoManager.redo()).toBe(true);
		expect(visibleText(editor.getBlock(secondBlockId)!.textContent())).toBe(
			"AI output",
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.undoManager.undo()).toBe(true);
		expect(visibleText(editor.getBlock(firstBlockId)!.textContent())).toBe(
			"",
		);
		expect(visibleText(editor.getBlock(secondBlockId)!.textContent())).toBe(
			"",
		);

		editor.destroy();
	});

	it("tracks imported edits in the undo stack", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream"],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply(
			[
				{
					type: "insert-text",
					blockId,
					offset: 0,
					text: "Imported text",
				},
			],
			{ origin: "import", undoGroup: true },
		);

		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"Imported text",
		);
		expect(editor.undoManager.undo()).toBe(true);
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		editor.destroy();
	});

	it("emits history origin for undo transactions on documentCommit", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream"],
		});
		const blockId = editor.firstBlock()!.id;
		const commitOrigins: string[] = [];

		editor.on("documentCommit", (event) => {
			commitOrigins.push(event.origin);
		});

		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "Hello",
			},
		]);

		editor.undoManager.undo();

		expect(commitOrigins).toContain("user");
		expect(commitOrigins).toContain("history");

		editor.destroy();
	});
});

describe("@pen/core table operations", () => {
	it("insert-block with table type produces seeded 2x2 grid", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		const block = editor.getBlock("t1")!;
		expect(block.type).toBe("table");
		expect(block.tableRowCount()).toBe(2);
		expect(block.tableColumnCount()).toBe(2);

		const cell = block.tableCell(0, 0)!;
		expect(cell).not.toBeNull();
		expect(cell.id).toEqual(expect.any(String));
		expect(cell.textContent()).toBe("");

		editor.destroy();
	});

	it("insert-table-row adds a row matching existing column count", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "insert-table-row",
				blockId: "t1",
				index: 2,
			},
		]);

		const block = editor.getBlock("t1")!;
		expect(block.tableRowCount()).toBe(3);
		expect(block.tableColumnCount()).toBe(2);
		expect(block.tableCell(2, 0)).not.toBeNull();
		expect(block.tableCell(2, 1)).not.toBeNull();

		editor.destroy();
	});

	it("repairs table width from the widest row when legacy rows are short", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "insert-table-column",
				blockId: "t1",
				index: 2,
			},
		]);

		const blockMap = (editor.internals.doc.blocks as any).get("t1");
		const tableContent = blockMap.get("tableContent");
		const firstRow = tableContent.get(0);
		firstRow.get("cells").delete(2, 1);

		let block = editor.getBlock("t1")!;
		expect(block.tableColumnCount()).toBe(3);

		editor.apply([
			{
				type: "insert-table-row",
				blockId: "t1",
				index: block.tableRowCount(),
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 0,
				col: 2,
				offset: 0,
				text: "Recovered",
			},
		]);

		block = editor.getBlock("t1")!;
		expect(block.tableRowCount()).toBe(3);
		expect(block.tableCell(0, 2)?.textContent()).toBe("Recovered");
		expect(block.tableCell(2, 0)).not.toBeNull();
		expect(block.tableCell(2, 1)).not.toBeNull();
		expect(block.tableCell(2, 2)).not.toBeNull();

		editor.destroy();
	});

	it("insert-table-column adds a column to all rows", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "insert-table-column",
				blockId: "t1",
				index: 2,
			},
		]);

		const block = editor.getBlock("t1")!;
		expect(block.tableRowCount()).toBe(2);
		expect(block.tableColumnCount()).toBe(3);
		expect(block.tableCell(0, 2)).not.toBeNull();
		expect(block.tableCell(1, 2)).not.toBeNull();

		editor.destroy();
	});

	it("delete-table-row removes a row", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "delete-table-row",
				blockId: "t1",
				index: 0,
			},
		]);

		expect(editor.getBlock("t1")!.tableRowCount()).toBe(1);

		editor.destroy();
	});

	it("delete-table-column removes a column from all rows", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "delete-table-column",
				blockId: "t1",
				index: 0,
			},
		]);

		expect(editor.getBlock("t1")!.tableColumnCount()).toBe(1);

		editor.destroy();
	});

	it("insert-table-cell-text writes text into a specific cell", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 0,
				col: 1,
				offset: 0,
				text: "Hello",
			},
		]);

		const cell = editor.getBlock("t1")!.tableCell(0, 1)!;
		expect(cell.textContent()).toBe("Hello");

		editor.destroy();
	});

	it("delete-table-cell-text removes text from a specific cell", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 0,
				col: 0,
				offset: 0,
				text: "Hello",
			},
			{
				type: "delete-table-cell-text",
				blockId: "t1",
				row: 0,
				col: 0,
				offset: 1,
				length: 3,
			},
		]);

		const cell = editor.getBlock("t1")!.tableCell(0, 0)!;
		expect(cell.textContent()).toBe("Ho");

		editor.destroy();
	});

	it("format-table-cell-text applies formatting to cell text", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
			{
				type: "insert-table-cell-text",
				blockId: "t1",
				row: 0,
				col: 0,
				offset: 0,
				text: "bold text",
			},
			{
				type: "format-table-cell-text",
				blockId: "t1",
				row: 0,
				col: 0,
				offset: 0,
				length: 4,
				marks: { bold: true },
			},
		]);

		const cell = editor.getBlock("t1")!.tableCell(0, 0)!;
		const deltas = cell.textDeltas();
		expect(deltas[0].insert).toBe("bold");
		expect(deltas[0].attributes).toEqual({ bold: true });
		expect(deltas[1].insert).toBe(" text");

		editor.destroy();
	});

	it("convert-block to table seeds tableContent", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
		]);

		editor.apply([
			{
				type: "convert-block",
				blockId: "b1",
				newType: "table",
				newProps: {},
			},
		]);

		const block = editor.getBlock("b1")!;
		expect(block.type).toBe("table");
		expect(block.tableRowCount()).toBe(2);
		expect(block.tableColumnCount()).toBe(2);

		editor.destroy();
	});

	it("convert-block to table preserves inline text in the first cell", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "b1",
				blockType: "paragraph",
				props: {},
				position: "last",
			},
			{
				type: "insert-text",
				blockId: "b1",
				offset: 0,
				text: "Hello table",
			},
		]);

		editor.apply([
			{
				type: "convert-block",
				blockId: "b1",
				newType: "table",
				newProps: {},
			},
		]);

		const block = editor.getBlock("b1")!;
		expect(block.type).toBe("table");
		expect(block.tableCell(0, 0)?.textContent()).toBe("Hello table");
		expect(block.tableCell(0, 1)?.textContent()).toBe("");
		expect(block.tableCell(1, 0)?.textContent()).toBe("");
		expect(block.tableCell(1, 1)?.textContent()).toBe("");

		editor.destroy();
	});

	it("tableCell returns null for out-of-bounds coordinates", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "t1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);

		const block = editor.getBlock("t1")!;
		expect(block.tableCell(-1, 0)).toBeNull();
		expect(block.tableCell(0, -1)).toBeNull();
		expect(block.tableCell(99, 0)).toBeNull();
		expect(block.tableCell(0, 99)).toBeNull();

		editor.destroy();
	});

	it("tableRowCount/tableColumnCount return 0 for non-table blocks", () => {
		const editor = createEditor({
			without: ["document-ops", "delta-stream", "undo"],
		});

		const block = editor.firstBlock()!;
		expect(block.tableRowCount()).toBe(0);
		expect(block.tableColumnCount()).toBe(0);
		expect(block.tableCell(0, 0)).toBeNull();

		editor.destroy();
	});
});
