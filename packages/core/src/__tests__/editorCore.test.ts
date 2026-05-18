import { yjsAdapter } from "@pen/crdt-yjs";
import { processStream } from "@pen/delta-stream";
import { inputRulesExtension } from "@pen/input-rules";
import { undoExtension } from "@pen/undo";
import {
	defineExtension,
	type DocumentSession,
	type PenStreamPart,
	getOpOriginType,
} from "@pen/types";
import { describe, expect, it, vi } from "vitest";

import {
	createDecorationSet,
	createDocumentSession,
	createEditor as createCoreEditor,
	createHeadlessEditor,
	ensureInlineCompletionController,
} from "../index";

const noDefaultExtensionsPreset = {
	resolve() {
		return { extensions: [] };
	},
};

const undoOnlyPreset = {
	resolve() {
		return { extensions: [undoExtension()] };
	},
};

function createEditor(options: Parameters<typeof createCoreEditor>[0] = {}) {
	return createCoreEditor({
		...options,
		preset: options.preset ?? noDefaultExtensionsPreset,
	});
}

function createDefaultEditor(
	options: Parameters<typeof createCoreEditor>[0] = {},
) {
	return createCoreEditor(options);
}

function createEditorWithUndo(
	options: Parameters<typeof createCoreEditor>[0] = {},
) {
	return createCoreEditor({
		...options,
		preset: options.preset ?? undoOnlyPreset,
	});
}

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

type TestYTextLike = {
	insert(offset: number, text: string): void;
};

type TestBlockMapLike = {
	get(key: string): unknown;
};

type TestBlocksMapLike = {
	get(key: string): TestBlockMapLike | undefined;
};

type TestRawDocLike = {
	getMap(name: "blocks"): TestBlocksMapLike;
};

type TestTableRowLike = {
	get(field: "cells"): { delete(index: number, length: number): void };
};

type TestTableContentLike = {
	get(index: number): TestTableRowLike;
};

describe("@pen/core createEditor", () => {
	it("warns once when using the deprecated without option", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		const editor = createCoreEditor({
			without: ["document-ops"],
		});
		editor.destroy();

		expect(warnSpy).toHaveBeenCalledWith(
			"Pen: createEditor({ without }) is deprecated. Prefer createEditor({ preset: defaultPreset(...) }) for default feature composition.",
		);

		warnSpy.mockRestore();
	});

	it("installs extensions from presets before user extensions", () => {
		const editor = createEditor({
			preset: {
				resolve() {
					return {
						extensions: [
							defineExtension({
								name: "preset-test-extension",
								activateClient: async (ctx) => {
									ctx.editor.internals.setSlot(
										"test:preset-installed",
										true,
									);
								},
							}),
						],
					};
				},
			},
		});

		expect(editor.internals.getSlot("test:preset-installed")).toBe(true);

		editor.destroy();
	});

	it("supports multiple editors sharing one document session", () => {
		const session = createDocumentSession({
			adapter: yjsAdapter(),
		});
		const editorA = createEditor({
			documentSession: session,
		});
		const editorB = createEditor({
			documentSession: session,
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

	it("creates headless editors around caller-owned documents without default undo behavior", () => {
		const adapter = yjsAdapter();
		const document = adapter.createDocument();
		const editor = createHeadlessEditor({ crdt: adapter, document });
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "Server edit",
			},
		]);

		expect(editor.getBlock(blockId)?.textContent()).toBe("Server edit");
		expect(editor.undoManager.undo()).toBe(false);

		editor.destroy();
	});

	it("does not destroy caller-owned documents on editor teardown", () => {
		const adapter = yjsAdapter();
		const document = adapter.createDocument();
		const editorA = createEditor({
			document,
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
		});

		expect(editorB.getBlock(blockId)?.textContent()).toBe("Persisted");

		editorB.destroy();
	});

	it("persists document profile metadata for new editors", () => {
		const editor = createEditor({
			documentProfile: "flow",
		});

		expect(editor.documentProfile).toBe("flow");
		expect(editor.documentState.documentProfile).toBe("flow");
		expect(editor.editorViewMode).toBe("flow");
		expect(
			editor.internals.adapter.getDocumentProfile?.(
				editor.internals.crdtDoc,
			),
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
		expect(childEditor.documentScope.parentId).toBe(
			rootEditor.documentScope.id,
		);
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

	it("supports delegated document session implementations for scope replacement", async () => {
		const baseSession = createDocumentSession({
			adapter: yjsAdapter(),
		});
		const delegatedSession: DocumentSession = {
			adapter: baseSession.adapter,
			get rootScope() {
				return baseSession.rootScope;
			},
			getScope: (scopeId) => baseSession.getScope(scopeId),
			getScopeByGuid: (guid) => baseSession.getScopeByGuid(guid),
			getScopeForBlock: (blockId, options) =>
				baseSession.getScopeForBlock(blockId, options),
			listScopes: () => baseSession.listScopes(),
			getAwareness: (scopeId) => baseSession.getAwareness(scopeId),
			observe: (scopeId, callback) =>
				baseSession.observe(scopeId, callback),
			observeAll: (callback) => baseSession.observeAll(callback),
			createSubdocument: (blockId, options) =>
				baseSession.createSubdocument(blockId, options),
			loadSubdocument: (scopeId) => baseSession.loadSubdocument(scopeId),
			replaceScopeDocument: (scopeId, doc, options) =>
				baseSession.replaceScopeDocument(scopeId, doc, options),
			attachEditor: (options) => baseSession.attachEditor(options),
			destroy: () => baseSession.destroy(),
		};
		const editor = createEditor({
			documentSession: delegatedSession,
		});
		const originalDoc = editor.internals.crdtDoc;
		const replacementSource = createEditor();
		const replacementDoc = delegatedSession.adapter.loadDocument(
			delegatedSession.adapter.encodeState(
				replacementSource.internals.crdtDoc,
			),
		);

		delegatedSession.replaceScopeDocument(
			editor.documentScope.id,
			replacementDoc,
		);
		await flushMicrotasks();

		expect(editor.internals.crdtDoc).toBe(replacementDoc);
		expect(editor.internals.crdtDoc).not.toBe(originalDoc);
		expect(editor.firstBlock()).not.toBeNull();

		replacementSource.destroy();
		editor.destroy();
		delegatedSession.destroy();
	});

	it("rebinds child-scope editors when the root session document is replaced", async () => {
		const session = createDocumentSession({
			adapter: yjsAdapter(),
		});
		const rootEditor = createEditor({
			documentSession: session,
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
		const childEditor = createEditor({
			documentSession: session,
			documentScopeId: childScope!.id,
		});
		const childBlockId = childEditor.firstBlock()!.id;
		childEditor.apply([
			{
				type: "insert-text",
				blockId: childBlockId,
				offset: 0,
				text: "Original nested content",
			},
		]);

		const replacementSession = createDocumentSession({
			adapter: yjsAdapter(),
			ownsDocuments: false,
		});
		const replacementRootEditor = createEditor({
			documentSession: replacementSession,
		});
		replacementRootEditor.apply([
			{
				type: "insert-block",
				blockId: "subdoc-block",
				blockType: "subdocument",
				props: { title: "Nested" },
				position: "last",
			},
		]);
		const replacementChildScope = replacementSession.getScopeForBlock(
			"subdoc-block",
			{
				scopeId: replacementRootEditor.documentScope.id,
			},
		);
		const replacementChildEditor = createEditor({
			documentSession: replacementSession,
			documentScopeId: replacementChildScope!.id,
		});
		const replacementChildBlockId = replacementChildEditor.firstBlock()!.id;
		replacementChildEditor.apply([
			{
				type: "insert-text",
				blockId: replacementChildBlockId,
				offset: 0,
				text: "Replacement nested content",
			},
		]);

		session.replaceScopeDocument(
			rootEditor.documentScope.id,
			replacementSession.rootScope.doc,
		);
		await flushMicrotasks();

		expect(childEditor.firstBlock()?.textContent()).toBe(
			"Replacement nested content",
		);
		expect(childEditor.documentScope.ownerBlockId).toBe("subdoc-block");
		expect(childEditor.documentScope.parentId).toBe(
			rootEditor.documentScope.id,
		);

		replacementChildEditor.destroy();
		replacementRootEditor.destroy();
		replacementSession.destroy();
		childEditor.destroy();
		rootEditor.destroy();
		session.destroy();
	});

	it("creates a working editor with default schema and extensions", () => {
		const editor = createDefaultEditor();

		expect(editor.schema.resolve("paragraph")).toBeTruthy();
		expect(typeof editor.clientId).toBe("number");
		expect(editor.internals.getSlot("core:engine")).toBe(
			editor.internals.engine,
		);
		expect(
			editor.internals.getSlot("document-ops:toolRuntime"),
		).toBeTruthy();
		expect(editor.internals.getSlot("undo:manager")).toBeTruthy();

		editor.destroy();
	});

	it("starts with a single empty paragraph block in zero-config mode", () => {
		const editor = createDefaultEditor();

		expect(editor.blockCount()).toBe(1);
		expect(editor.firstBlock()?.type).toBe("paragraph");
		expect(editor.firstBlock()?.textContent()).toBe("");

		editor.destroy();
	});

	it("applies insert-block and insert-text operations", () => {
		const editor = createEditor();

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

	it("moves the text selection after accepting an inline completion", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		const { controller } = ensureInlineCompletionController(editor);

		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);
		controller.showSuggestion({
			id: "suggestion-1",
			blockId,
			offset: 5,
			text: " world",
			type: "inline",
		});

		expect(controller.acceptSuggestion()).toBe(true);

		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world");
		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 11 },
			focus: { blockId, offset: 11 },
		});

		editor.destroy();
	});

	it("splits and merges inline blocks", () => {
		const editor = createEditor();

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

	it("splits at offset zero by inserting an empty block above", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "hello world",
			},
		]);

		editor.apply([
			{
				type: "split-block",
				blockId,
				offset: 0,
				newBlockId: "b2",
			},
		]);

		expect(editor.documentState.blockOrder).toEqual([blockId, "b2"]);
		expect(editor.getBlock(blockId)?.textContent()).toBe("");
		expect(editor.getBlock("b2")?.textContent()).toBe("hello world");

		editor.destroy();
	});

	it("preserves full text offsets for code blocks", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;

		editor.apply([
			{ type: "convert-block", blockId, newType: "codeBlock" },
			{ type: "insert-text", blockId, offset: 0, text: "abcd" },
		]);

		editor.selectTextRange({ blockId, offset: 1 }, { blockId, offset: 3 });

		expect(editor.selection).toMatchObject({
			type: "text",
			anchor: { blockId, offset: 1 },
			focus: { blockId, offset: 3 },
		});
		expect(editor.getSelectedText()).toBe("bc");

		editor.destroy();
	});

	it("clears stale grid state when converting table or database blocks", () => {
		const editor = createEditor();

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

		const tableBlockMap = editor.internals.doc.blocks.get(
			"table-block",
		) as TestBlockMapLike;
		const databaseBlockMap = editor.internals.doc.blocks.get(
			"database-block",
		) as TestBlockMapLike;
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
			extensions: [inputRulesExtension()],
		});
		const blockId = editor.firstBlock()!.id;

		editor.selectTextRange({ blockId, offset: 0 }, { blockId, offset: 0 });

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
		editor.selectTextRange({ blockId, offset: 1 }, { blockId, offset: 1 });
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

		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"hello",
		);
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
		expect(
			(documentCommits[0] as { blockRevisions: Record<string, number> })
				.blockRevisions[blockId],
		).toBe(editor.getBlockRevision(blockId));
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
			extensions: [ext],
		});
		const changes: unknown[][] = [];
		const documentCommits: unknown[] = [];
		const adapter = editor.internals.adapter;
		const editorDoc = editor.internals.crdtDoc;
		const blockId = editor.firstBlock()!.id;
		const remoteDoc = adapter.loadDocument(adapter.encodeState(editorDoc));
		const remoteYDoc = adapter.raw<TestRawDocLike>(remoteDoc);
		const remoteYText = remoteYDoc
			.getMap("blocks")
			.get(blockId)
			?.get("content") as TestYTextLike | undefined;
		if (!remoteYText) {
			throw new Error(`Missing collaborator text for block ${blockId}`);
		}

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
		expect(
			(documentCommits[0] as { blockRevisions: Record<string, number> })
				.blockRevisions[blockId],
		).toBe(editor.getBlockRevision(blockId));
		expect(observed).toHaveLength(1);
		expect(observed[0]).toHaveLength(1);

		editor.destroy();
	});

	it("clamps text selections and returns backwards selected text", () => {
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();
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

	it("rebinds undo manager after loadDocument", async () => {
		const editor = createDefaultEditor();
		const newDoc = editor.internals.adapter.createDocument();

		editor.loadDocument(newDoc);
		await flushMicrotasks();

		expect(editor.undoManager).toBe(
			editor.internals.getSlot("undo:manager"),
		);

		editor.destroy();
	});

	it("waits for async extension teardown before reactivating after loadDocument", async () => {
		const steps: string[] = [];
		let activationCount = 0;
		let resolveDeactivate!: () => void;
		const deactivatePromise = new Promise<void>((resolve) => {
			resolveDeactivate = resolve;
		});
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "async-lifecycle",
					activateClient: async () => {
						activationCount += 1;
						steps.push(`activate:${activationCount}`);
					},
					deactivateClient: async () => {
						steps.push("deactivate:start");
						await deactivatePromise;
						steps.push("deactivate:end");
					},
				}),
			],
		});

		await flushMicrotasks();

		editor.loadDocument(editor.internals.adapter.createDocument());
		await flushMicrotasks();

		expect(steps).toEqual(["activate:1", "deactivate:start"]);

		resolveDeactivate();
		await flushMicrotasks(4);

		expect(steps).toEqual([
			"activate:1",
			"deactivate:start",
			"deactivate:end",
			"activate:2",
		]);

		editor.destroy();
	});

	it("refreshes editor.undoManager immediately when the undo slot is set", async () => {
		const registeredUndoManager = {
			undo: () => false,
			redo: () => false,
			canUndo: () => false,
			canRedo: () => false,
			stopCapturing: () => {},
			syncExplicitUndoGroup: () => {},
			setGroupTimeout: () => {},
			registerTrackedOrigins: () => () => {},
			onStackChange: () => () => {},
		};
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "test-undo-slot",
					activateClient: async ({ editor }) => {
						expect(editor.undoManager).not.toBe(
							registeredUndoManager,
						);
						editor.internals.setSlot(
							"undo:manager",
							registeredUndoManager,
						);
						expect(editor.undoManager).toBe(registeredUndoManager);
					},
				}),
			],
		});

		await Promise.resolve();

		expect(editor.undoManager).toBe(registeredUndoManager);

		editor.destroy();
	});

	it("updates documentState parent relationships after parentId changes", () => {
		const editor = createEditor();

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
		const editor = createEditor();
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

	it("emits diagnostics for rejected async extension activation", async () => {
		const diagnostics: unknown[] = [];
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "broken-async-activate",
					activateClient: async () => {
						await Promise.resolve();
						throw new Error("boom");
					},
				}),
			],
		});

		editor.on("diagnostic", (event) => {
			diagnostics.push(event);
		});

		await flushMicrotasks(4);

		expect(diagnostics).toContainEqual(
			expect.objectContaining({
				code: "PEN_EXT_004",
				level: "error",
				source: "extension",
				extension: "broken-async-activate",
				remediation: expect.any(String),
			}),
		);

		editor.destroy();
	});

	it("processes streamed AI deltas through the default delta-stream pipeline", async () => {
		const editor = createDefaultEditor();
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
		const editor = createDefaultEditor();
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

	it("keeps concurrent user edits outside the generation zone in a separate undo group", async () => {
		const editor = createDefaultEditor();
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

		await processStream(
			(async function* (): AsyncIterable<PenStreamPart> {
				yield {
					type: "gen-start",
					zoneId: "zone-concurrent",
					blockId: secondBlockId,
				};

				editor.apply(
					[
						{
							type: "insert-text",
							blockId: firstBlockId,
							offset: 0,
							text: "user edit",
						},
					],
					{ origin: "user" },
				);

				yield {
					type: "gen-delta",
					zoneId: "zone-concurrent",
					delta: "AI output",
				};
				yield {
					type: "gen-end",
					zoneId: "zone-concurrent",
					status: "complete",
				};
			})(),
			editor,
		);

		expect(visibleText(editor.getBlock(firstBlockId)!.textContent())).toBe(
			"user edit",
		);
		expect(visibleText(editor.getBlock(secondBlockId)!.textContent())).toBe(
			"AI output",
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(visibleText(editor.getBlock(firstBlockId)!.textContent())).toBe(
			"user edit",
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

	it("keeps user edits inside the generation zone in the same undo group", async () => {
		const editor = createDefaultEditor();
		const blockId = editor.firstBlock()!.id;

		await processStream(
			(async function* (): AsyncIterable<PenStreamPart> {
				yield { type: "gen-start", zoneId: "zone-shared", blockId };
				yield {
					type: "gen-delta",
					zoneId: "zone-shared",
					delta: "AI ",
				};

				editor.apply(
					[
						{
							type: "insert-text",
							blockId,
							offset: 3,
							text: "user ",
						},
					],
					{ origin: "user" },
				);

				yield {
					type: "gen-delta",
					zoneId: "zone-shared",
					delta: "output",
				};
				yield {
					type: "gen-end",
					zoneId: "zone-shared",
					status: "complete",
				};
			})(),
			editor,
		);

		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"user AI output",
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe("");

		expect(editor.undoManager.redo()).toBe(true);
		expect(visibleText(editor.getBlock(blockId)!.textContent())).toBe(
			"user AI output",
		);

		editor.destroy();
	});

	it("tracks imported edits in the undo stack", () => {
		const editor = createEditorWithUndo();
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
		const editor = createEditorWithUndo();
		const blockId = editor.firstBlock()!.id;
		const commitOrigins: string[] = [];

		editor.on("documentCommit", (event) => {
			commitOrigins.push(getOpOriginType(event.origin));
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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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

		const blockMap = editor.internals.doc.blocks.get(
			"t1",
		) as TestBlockMapLike;
		const tableContent = blockMap.get(
			"tableContent",
		) as TestTableContentLike;
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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

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
		const editor = createEditor();

		const block = editor.firstBlock()!;
		expect(block.tableRowCount()).toBe(0);
		expect(block.tableColumnCount()).toBe(0);
		expect(block.tableCell(0, 0)).toBeNull();

		editor.destroy();
	});

	it("caches decoration snapshots between decoration updates", () => {
		const editor = createEditor({
			extensions: [
				defineExtension({
					name: "test-decorations",
					decorations(_state, currentEditor) {
						const blockId = currentEditor.firstBlock()?.id;
						if (!blockId) {
							return createDecorationSet([]);
						}

						return createDecorationSet([
							{
								type: "block",
								blockId,
								attributes: { active: true },
							},
						]);
					},
				}),
			],
		});

		const initialDecorations = editor.getDecorations();
		const repeatedDecorations = editor.getDecorations();
		expect(repeatedDecorations).toBe(initialDecorations);

		editor.apply(
			[
				{
					type: "insert-text",
					blockId: editor.firstBlock()!.id,
					offset: 0,
					text: "trigger",
				},
			],
			{ origin: "user" },
		);

		const autoRefreshedDecorations = editor.getDecorations();
		expect(autoRefreshedDecorations).not.toBe(initialDecorations);
		expect(editor.getDecorations()).toBe(autoRefreshedDecorations);

		editor.requestDecorationUpdate();

		const refreshedDecorations = editor.getDecorations();
		expect(refreshedDecorations).not.toBe(autoRefreshedDecorations);
		expect(editor.getDecorations()).toBe(refreshedDecorations);

		editor.destroy();
	});
});
