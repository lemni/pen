import { describe, expect, it } from "vitest";
import { createEditor } from "@pen/core";
import { defineExtension, type ToolRuntime } from "@pen/types";
import {
	acceptAllSuggestions,
	acceptSuggestion,
	aiExtension,
	getAIInlineHistoryController,
	getAIController,
	rejectSuggestion,
} from "../index";
import {
	readAllSuggestions,
	readBlockSuggestionMeta,
	readSuggestionsFromBlock,
} from "../suggestions/persistent";

function testStreamingToolExtension() {
	let toolRuntime: ToolRuntime | null = null;

	return defineExtension({
		name: "test-streaming-tool",
		dependencies: ["document-ops"],
		activateClient: async ({ editor }) => {
			toolRuntime = editor.internals.getSlot<ToolRuntime>("document-ops:toolRuntime") ?? null;
			toolRuntime?.registerTool({
				name: "test_search",
				description: "Test streaming search tool",
				inputSchema: {
					type: "object",
					required: ["query"],
					properties: {
						query: { type: "string" },
					},
				},
				async *handler(input) {
					const { query } = input as { query: string };
					yield `searching:${query}`;
					yield { matches: 2, query };
				},
			});
		},
		deactivateClient: async () => {
			toolRuntime?.unregisterTool("test_search");
			toolRuntime = null;
		},
	});
}

function createDeferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

async function waitForPreview(
	readPreview: () => unknown,
	maxTicks = 10,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (readPreview()) {
			return;
		}
		await Promise.resolve();
	}
}

describe("aiExtension", () => {
	it("marks inserted and deleted text in suggest mode", () => {
		const editor = createEditor({
			extensions: [aiExtension({ suggestMode: true, author: "tester" })],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "user" },
		);
		editor.apply(
			[{ type: "delete-text", blockId, offset: 6, length: 5 }],
			{ origin: "user" },
		);

		const block = editor.getBlock(blockId)!;
		const deltas = block.textDeltas();

		expect(deltas[0]?.attributes?.suggestion).toMatchObject({
			action: "insert",
			author: "tester",
		});
		expect(deltas[1]?.attributes?.suggestion).toMatchObject({
			action: "delete",
			author: "tester",
		});
		expect(block.textContent()).toBe("Hello world");
		expect(block.textContent({ resolved: true })).toBe("Hello ");
	});

	it("rejects persistent suggestions through the controller", () => {
		const editor = createEditor({
			extensions: [aiExtension({ suggestMode: true, author: "tester" })],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello" }],
			{ origin: "user" },
		);

		const controller = getAIController(editor)!;
		const suggestionsSnapshot = controller.getSuggestions();
		const suggestion = suggestionsSnapshot[0];
		expect(suggestion).toBeDefined();
		expect(controller.getSuggestions()).toBe(suggestionsSnapshot);

		expect(rejectSuggestion(editor, suggestion.id)).toBe(true);
		expect(editor.getBlock(blockId)!.textContent({ resolved: true })).toBe("");
		expect(readSuggestionsFromBlock(editor, blockId)).toEqual([]);
		expect(readAllSuggestions(editor)).toEqual([]);
		expect(editor.getBlock(blockId)!.textContent()).toBe("");
	});

	it("accepts persistent suggestions without re-intercepting them", () => {
		const editor = createEditor({
			extensions: [aiExtension({ suggestMode: true, author: "tester" })],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello" }],
			{ origin: "system" },
		);
		editor.apply(
			[{ type: "delete-text", blockId, offset: 0, length: 5 }],
			{ origin: "user" },
		);

		const [suggestion] = readSuggestionsFromBlock(editor, blockId);
		expect(suggestion).toBeDefined();

		expect(acceptSuggestion(editor, suggestion.id)).toBe(true);
		expect(editor.getBlock(blockId)!.textContent({ resolved: true })).toBe("");
		expect(readSuggestionsFromBlock(editor, blockId)).toEqual([]);
		expect(readAllSuggestions(editor)).toEqual([]);
		expect(editor.getBlock(blockId)!.textContent()).toBe("");
	});

	it("keeps accepted delete suggestions in document undo history", () => {
		const editor = createEditor({
			extensions: [aiExtension({ suggestMode: true, author: "tester" })],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello" }],
			{ origin: "system" },
		);
		editor.apply(
			[{ type: "delete-text", blockId, offset: 0, length: 5 }],
			{ origin: "user" },
		);

		const [suggestion] = readSuggestionsFromBlock(editor, blockId);
		expect(suggestion).toBeDefined();
		expect(acceptSuggestion(editor, suggestion.id)).toBe(true);
		expect(editor.getBlock(blockId)!.textContent()).toBe("");
		expect(readSuggestionsFromBlock(editor, blockId)).toEqual([]);

		expect(editor.undoManager.undo()).toBe(true);
		expect(readSuggestionsFromBlock(editor, blockId)).toHaveLength(1);
		expect(readAllSuggestions(editor)).toHaveLength(1);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(blockId)!.textContent({ resolved: true })).toBe("Hello");
		expect(readSuggestionsFromBlock(editor, blockId)).toEqual([]);

		expect(editor.undoManager.redo()).toBe(true);
		expect(readSuggestionsFromBlock(editor, blockId)).toHaveLength(1);
		expect(readAllSuggestions(editor)).toHaveLength(1);

		expect(editor.undoManager.redo()).toBe(true);
		expect(editor.getBlock(blockId)!.textContent()).toBe("");
		expect(readSuggestionsFromBlock(editor, blockId)).toEqual([]);
	});

	it("keeps rejected insert suggestions in document undo history", () => {
		const editor = createEditor({
			extensions: [aiExtension({ suggestMode: true, author: "tester" })],
		});
		const blockId = editor.firstBlock()!.id;

		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello" }],
			{ origin: "user" },
		);

		const [suggestion] = readSuggestionsFromBlock(editor, blockId);
		expect(suggestion).toBeDefined();
		expect(rejectSuggestion(editor, suggestion.id)).toBe(true);
		expect(editor.getBlock(blockId)!.textContent()).toBe("");
		expect(readSuggestionsFromBlock(editor, blockId)).toEqual([]);

		expect(editor.undoManager.undo()).toBe(true);
		expect(readSuggestionsFromBlock(editor, blockId)).toHaveLength(1);
		expect(readAllSuggestions(editor)).toHaveLength(1);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(blockId)!.textContent({ resolved: true })).toBe("");
		expect(readSuggestionsFromBlock(editor, blockId)).toEqual([]);

		expect(editor.undoManager.redo()).toBe(true);
		expect(readSuggestionsFromBlock(editor, blockId)).toHaveLength(1);
		expect(readAllSuggestions(editor)).toHaveLength(1);

		expect(editor.undoManager.redo()).toBe(true);
		expect(editor.getBlock(blockId)!.textContent()).toBe("");
		expect(readSuggestionsFromBlock(editor, blockId)).toEqual([]);
	});

	it("accepts multiple suggestions in one undo group", () => {
		const editor = createEditor({
			extensions: [aiExtension({ suggestMode: true, author: "tester" })],
		});
		const firstBlockId = editor.firstBlock()!.id;

		editor.apply(
			[{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Hello" }],
			{ origin: "user" },
		);
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: "b2",
					blockType: "paragraph",
					props: {},
					position: "last",
				},
			],
			{ origin: "user" },
		);

		expect(readAllSuggestions(editor)).toHaveLength(2);

		acceptAllSuggestions(editor);
		expect(readAllSuggestions(editor)).toEqual([]);

		expect(editor.undoManager.undo()).toBe(true);
		expect(readAllSuggestions(editor)).toHaveLength(2);

		expect(editor.undoManager.redo()).toBe(true);
		expect(readAllSuggestions(editor)).toEqual([]);
	});

	it("runs a block generation with a model adapter", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " world" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Continue", { blockId });

		expect(generation.status).toBe("complete");
		expect(editor.getBlock(blockId)!.textContent()).toBe("Hello world");
		expect(controller.getState().activeGeneration?.text).toBe(" world");
	});

	it("parses markdown block generations into structured blocks", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: { blockGeneration: "markdown" },
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "# Title\n\n- One",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const targetBlockId = "target-block";
		const trailingBlockId = "trailing-block";
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: targetBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "insert-block",
					blockId: trailingBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: targetBlockId },
				},
				{
					type: "insert-text",
					blockId: trailingBlockId,
					offset: 0,
					text: "Outro",
				},
			],
			{ origin: "system" },
		);
		const initialRowCount = editor.getBlock("table-1")?.tableRowCount();

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Continue this paragraph", {
			blockId: targetBlockId,
		});
		const blockOrder = editor.documentState.blockOrder;

		expect(generation.status).toBe("complete");
		expect(generation.contentFormat).toBe("markdown");
		expect(blockOrder).toHaveLength(4);
		expect(blockOrder).not.toContain(targetBlockId);
		expect(editor.getBlock(blockOrder[0])?.textContent()).toBe("Intro");
		expect(editor.getBlock(blockOrder[1])?.type).toBe("heading");
		expect(editor.getBlock(blockOrder[1])?.textContent()).toBe("Title");
		expect(editor.getBlock(blockOrder[2])?.type).toBe("bulletListItem");
		expect(editor.getBlock(blockOrder[2])?.textContent()).toBe("One");
		expect(editor.getBlock(blockOrder[3])?.textContent()).toBe("Outro");
	});

	it("runs a selection generation when text is selected", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "planet" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Rewrite the selection");

		expect(generation.status).toBe("complete");
		expect(generation.mutationMode).toBe("streaming-suggestions");
		expect(editor.getBlock(blockId)!.textContent()).toBe("Hello worldplanet");
		expect(editor.getBlock(blockId)!.textContent({ resolved: true })).toBe("Hello planet");
		expect(controller.getState().activeGeneration?.text).toBe("planet");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
	});

	it("streams selection rewrites into persistent suggestions before completion", async () => {
		const releaseSecondDelta = createDeferred();
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "plan" };
							await releaseSecondDelta.promise;
							yield { type: "text-delta" as const, delta: "et" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const generationPromise = controller.runPrompt("Rewrite the selection");
		for (let tick = 0; tick < 6; tick += 1) {
			await Promise.resolve();
		}

		expect(controller.getState().ephemeralSuggestion).toBeNull();
		expect(editor.getBlock(blockId)!.textContent()).toBe("Hello worldplan");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);

		releaseSecondDelta.resolve();
		const generation = await generationPromise;

		expect(generation.status).toBe("complete");
		expect(editor.getBlock(blockId)!.textContent()).toBe("Hello worldplanet");
	});

	it("tracks session prompts and accepts session suggestions together", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "planet" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Rewrite the selection",
		);
		const nextSession = controller.getActiveSession();

		expect(generation.sessionId).toBe(session.id);
		expect(nextSession?.promptHistory).toHaveLength(1);
		expect(nextSession?.turns).toHaveLength(1);
		expect(nextSession?.turns[0]?.generationId).toBe(generation.id);
		expect(nextSession?.turns[0]?.status).toBe("review");
		expect(nextSession?.generationIds).toContain(generation.id);
		expect(nextSession?.pendingSuggestionIds.length).toBeGreaterThan(0);
		expect(controller.acceptSessionTurn(session.id, nextSession!.turns[0]!.id)).toBe(true);
		expect(editor.getBlock(blockId)!.textContent({ resolved: true })).toBe(
			"Hello planet",
		);
	});

	it("rewrites text that was previously accepted from AI", async () => {
		let pass = 0;
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							pass += 1;
							yield {
								type: "text-delta" as const,
								delta: pass === 1 ? "planet" : "galaxy",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const firstSession = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(firstSession).not.toBeNull();

		await controller.runSessionPrompt(firstSession!.id, "Rewrite the selection");
		const firstTurnId = controller.getActiveSession()?.turns[0]?.id;
		expect(firstTurnId).toBeTruthy();
		expect(controller.acceptSessionTurn(firstSession!.id, firstTurnId!)).toBe(true);
		expect(editor.getBlock(blockId)?.textContent({ resolved: true })).toBe(
			"Hello planet",
		);

		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 12 },
		);
		const secondSession = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(secondSession).not.toBeNull();
		expect(secondSession?.id).not.toBe(firstSession?.id);

		await controller.runSessionPrompt(secondSession!.id, "Rewrite the selection");
		const secondTurnId = controller.getActiveSession()?.turns.at(-1)?.id;
		expect(secondTurnId).toBeTruthy();
		expect(controller.acceptSessionTurn(secondSession!.id, secondTurnId!)).toBe(true);
		expect(editor.getBlock(blockId)?.textContent({ resolved: true })).toBe(
			"Hello galaxy",
		);
	});

	it("records selection rewrites in session fast-apply metrics", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "planet" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await controller.runSessionPrompt(session.id, "Rewrite the selection");

		expect(controller.getActiveSession()?.metrics.fastApply).toEqual({
			attemptCount: 1,
			nativeFastApplyCount: 1,
			scopedReplacementCount: 0,
			plainMarkdownCount: 0,
			failedCount: 0,
		});
	});

	it("accumulates fast-apply outcome counters across session turns", () => {
		const editor = createEditor({
			extensions: [
				aiExtension({ contentFormat: { blockGeneration: "markdown" } }),
			],
		});
		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "block",
		});
		const controllerAny = controller as any;

		controllerAny._recordSessionFastApplyMetrics(session.id, {
			attempted: true,
			succeeded: true,
			executionPath: "native-fast-apply",
		});
		controllerAny._recordSessionFastApplyMetrics(session.id, {
			attempted: true,
			succeeded: true,
			executionPath: "scoped-replacement",
		});
		controllerAny._recordSessionFastApplyMetrics(session.id, {
			attempted: true,
			succeeded: false,
			executionPath: "plain-markdown",
			fallbackReason: "unparseable-contract",
		});

		expect(controller.getActiveSession()?.metrics.fastApply).toEqual({
			attemptCount: 3,
			nativeFastApplyCount: 1,
			scopedReplacementCount: 1,
			plainMarkdownCount: 1,
			failedCount: 0,
		});
	});

	it("only restores a suspended inline session through history", () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});

		expect(session).not.toBeNull();
		controller.suspendInlineSession(session!.id);
		expect(controller.getState().activeSessionId).toBeNull();
		expect(
			controller.getState().sessions[0]?.contextualPrompt?.composer.isOpen,
		).toBe(false);

		editor.selectTextRange(
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		expect(controller.getState().activeSessionId).toBeNull();
		expect(
			controller.getState().sessions[0]?.contextualPrompt?.composer.isOpen,
		).toBe(false);

		editor.internals.emit("historyApplied", {
			kind: "undo",
			selection: editor.selection,
			focusBlockId: blockId,
			requestId: 1,
		});

		expect(controller.getState().activeSessionId).toBe(session!.id);
		expect(
			controller.getState().sessions[0]?.contextualPrompt?.composer.isOpen,
		).toBe(true);

		controller.suspendInlineSession(session!.id);
		editor.internals.emit("historyApplied", {
			kind: "redo",
			selection: editor.selection,
			focusBlockId: blockId,
			requestId: 2,
		});

		expect(controller.getState().activeSessionId).toBe(session!.id);
		expect(
			controller.getState().sessions[0]?.contextualPrompt?.composer.isOpen,
		).toBe(true);
	});

	it("records inline history at settled turn checkpoints instead of stream chunks", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "pla" };
							yield { type: "text-delta" as const, delta: "net" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();
		const inlineHistory = getAIInlineHistoryController(editor)!;

		await controller.runSessionPrompt(session!.id, "Rewrite this");
		controller.suspendInlineSession(session!.id);
		expect(controller.getState().sessions[0]?.turns).toHaveLength(1);
		expect(controller.getState().sessions[0]?.turns[0]?.status).toBe("review");

		expect(inlineHistory.undoInlineHistory()).toBe(true);
		expect(controller.getState().activeSessionId).toBe(session!.id);
		expect(
			controller.getState().sessions[0]?.contextualPrompt?.composer.isOpen,
		).toBe(true);
		expect(controller.getState().sessions[0]?.turns).toHaveLength(1);

		expect(inlineHistory.undoInlineHistory()).toBe(true);
		expect(controller.getState().sessions[0]?.turns).toHaveLength(0);
		expect(
			controller.getState().sessions[0]?.contextualPrompt?.composer.draftPrompt,
		).toBe("Rewrite this");
	});

	it("cycles selection inline turn history one turn at a time through shortcuts", async () => {
		let turnIndex = 0;
		const turnOutputs = ["planet", "galaxy"];
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: turnOutputs[turnIndex] ?? "done" };
							yield { type: "done" as const };
							turnIndex += 1;
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const inlineHistory = getAIInlineHistoryController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();

		await controller.runSessionPrompt(session!.id, "First rewrite");
		controller.suspendInlineSession(session!.id);
		await controller.runSessionPrompt(session!.id, "Second rewrite");
		controller.suspendInlineSession(session!.id);

		expect(controller.getState().sessions[0]?.turns).toHaveLength(2);
		expect(inlineHistory.canHandleShortcut("undo")).toBe(true);

		expect(inlineHistory.handleShortcut("undo")).toBe(true);
		expect(controller.getState().sessions[0]?.turns).toHaveLength(1);

		expect(inlineHistory.handleShortcut("undo")).toBe(true);
		expect(controller.getState().sessions).toHaveLength(0);
		expect(controller.getState().activeSessionId).toBeNull();

		expect(inlineHistory.canHandleShortcut("redo")).toBe(true);
		expect(inlineHistory.handleShortcut("redo")).toBe(true);
		expect(controller.getState().sessions[0]?.turns).toHaveLength(1);

		expect(inlineHistory.handleShortcut("redo")).toBe(true);
		expect(controller.getState().sessions[0]?.turns).toHaveLength(2);
	});

	it("keeps the public AI controller inline history methods available", async () => {
		let turnIndex = 0;
		const turnOutputs = ["planet", "galaxy"];
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: turnOutputs[turnIndex] ?? "done" };
							yield { type: "done" as const };
							turnIndex += 1;
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const inlineHistory = getAIInlineHistoryController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();

		await controller.runSessionPrompt(session!.id, "First rewrite");
		controller.suspendInlineSession(session!.id);
		await controller.runSessionPrompt(session!.id, "Second rewrite");
		controller.suspendInlineSession(session!.id);

		expect(controller.canUndoInlineHistory()).toBe(true);
		expect(controller.canRedoInlineHistory()).toBe(false);
		expect(inlineHistory.canHandleShortcut("undo")).toBe(true);
		expect(inlineHistory.canUndoInlineHistory()).toBe(true);
		expect(controller.undoInlineHistory()).toBe(true);
		expect(controller.canRedoInlineHistory()).toBe(true);
		expect(controller.redoInlineHistory()).toBe(true);
	});

	it("cycles selection inline turn history even when suggest mode is enabled", async () => {
		let turnIndex = 0;
		const turnOutputs = ["planet", "galaxy"];
		const editor = createEditor({
			extensions: [
				aiExtension({
					suggestMode: true,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: turnOutputs[turnIndex] ?? "done" };
							yield { type: "done" as const };
							turnIndex += 1;
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const inlineHistory = getAIInlineHistoryController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();

		await controller.runSessionPrompt(session!.id, "First rewrite");
		controller.suspendInlineSession(session!.id);
		await controller.runSessionPrompt(session!.id, "Second rewrite");
		controller.suspendInlineSession(session!.id);

		expect(inlineHistory.canHandleShortcut("undo")).toBe(true);
		expect(inlineHistory.handleShortcut("undo")).toBe(true);
		expect(controller.getState().sessions[0]?.turns).toHaveLength(1);

		expect(inlineHistory.handleShortcut("undo")).toBe(true);
		expect(controller.getState().sessions).toHaveLength(0);
	});

	it("prefers document undo over local inline history shortcuts when both exist", () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const inlineHistory = getAIInlineHistoryController(editor)!;
		const session = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(session).not.toBeNull();
		controller.suspendInlineSession(session!.id);

		editor.apply(
			[{ type: "insert-text", blockId, offset: 11, text: "!" }],
			{ origin: "user" },
		);

		expect(editor.getBlock(blockId)!.textContent()).toBe("Hello world!");
		expect(inlineHistory.canUndoInlineHistory()).toBe(true);
		expect(inlineHistory.canHandleShortcut("undo")).toBe(false);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock(blockId)!.textContent()).toBe("Hello world");
		expect(inlineHistory.canHandleShortcut("undo")).toBe(false);
	});

	it("creates a fresh inline session when the selection target changes", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "planet" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world again" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const firstSession = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(firstSession).not.toBeNull();

		await controller.runSessionPrompt(firstSession!.id, "Rewrite the selection");
		expect(controller.getState().sessions).toHaveLength(1);
		expect(controller.getState().sessions[0]?.turns).toHaveLength(1);

		editor.selectTextRange(
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);

		const secondSession = controller.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
		expect(secondSession).not.toBeNull();
		expect(secondSession?.id).not.toBe(firstSession?.id);
		expect(controller.getState().sessions).toHaveLength(2);
		expect(controller.getState().activeSessionId).toBe(secondSession?.id);
		expect(controller.getState().sessions[0]?.turns).toHaveLength(1);
		expect(controller.getState().sessions[0]?.contextualPrompt?.composer.isOpen).toBe(
			false,
		);
		expect(controller.getState().sessions[1]?.turns).toHaveLength(0);
		expect(controller.getState().sessions[1]?.contextualPrompt?.composer.isOpen).toBe(
			true,
		);
	});

	it("keeps inline session prompts selection-scoped for follow-up edits", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "planet" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Add an intro paragraph before this text",
		);

		expect(generation.target).toBe("selection");
		expect(controller.getState().sessions[0]?.turns[0]?.target).toBe("selection");
		expect(editor.documentState.blockOrder).toHaveLength(1);
	});

	it("closes the inline composer when resolving a session", async () => {
		const createInlineSessionEditor = () =>
			createEditor({
				extensions: [
					aiExtension({
						model: {
							async *stream() {
								yield { type: "text-delta" as const, delta: "planet" };
								yield { type: "done" as const };
							},
						},
					}),
				],
			});

		const acceptEditor = createInlineSessionEditor();
		const acceptBlockId = acceptEditor.firstBlock()!.id;
		acceptEditor.apply(
			[{ type: "insert-text", blockId: acceptBlockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		acceptEditor.selectTextRange(
			{ blockId: acceptBlockId, offset: 6 },
			{ blockId: acceptBlockId, offset: 11 },
		);
		const acceptController = getAIController(acceptEditor)!;
		const acceptSession = acceptController.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await acceptController.runSessionPrompt(
			acceptSession.id,
			"Rewrite the selection",
		);

		expect(acceptController.resolveSession(acceptSession.id, "accept")).toBe(true);
		expect(
			acceptController.getActiveSession()?.contextualPrompt?.composer.isOpen,
		).toBe(false);

		const rejectEditor = createInlineSessionEditor();
		const rejectBlockId = rejectEditor.firstBlock()!.id;
		rejectEditor.apply(
			[{ type: "insert-text", blockId: rejectBlockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		rejectEditor.selectTextRange(
			{ blockId: rejectBlockId, offset: 6 },
			{ blockId: rejectBlockId, offset: 11 },
		);
		const rejectController = getAIController(rejectEditor)!;
		const rejectSession = rejectController.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await rejectController.runSessionPrompt(
			rejectSession.id,
			"Rewrite the selection",
		);

		expect(rejectController.resolveSession(rejectSession.id, "reject")).toBe(true);
		expect(
			rejectController.getActiveSession()?.contextualPrompt?.composer.isOpen,
		).toBe(false);
	});

	it("closes the inline composer when resolving a session turn", async () => {
		const createInlineSessionEditor = () =>
			createEditor({
				extensions: [
					aiExtension({
						model: {
							async *stream() {
								yield { type: "text-delta" as const, delta: "planet" };
								yield { type: "done" as const };
							},
						},
					}),
				],
			});

		const acceptEditor = createInlineSessionEditor();
		const acceptBlockId = acceptEditor.firstBlock()!.id;
		acceptEditor.apply(
			[{ type: "insert-text", blockId: acceptBlockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		acceptEditor.selectTextRange(
			{ blockId: acceptBlockId, offset: 6 },
			{ blockId: acceptBlockId, offset: 11 },
		);
		const acceptController = getAIController(acceptEditor)!;
		const acceptSession = acceptController.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await acceptController.runSessionPrompt(
			acceptSession.id,
			"Rewrite the selection",
		);
		const acceptedTurnId = acceptController.getActiveSession()?.turns[0]?.id;

		expect(
			acceptController.resolveSessionTurn(
				acceptSession.id,
				acceptedTurnId!,
				"accept",
			),
		).toBe(true);
		expect(
			acceptController.getActiveSession()?.contextualPrompt?.composer.isOpen,
		).toBe(false);

		const rejectEditor = createInlineSessionEditor();
		const rejectBlockId = rejectEditor.firstBlock()!.id;
		rejectEditor.apply(
			[{ type: "insert-text", blockId: rejectBlockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		rejectEditor.selectTextRange(
			{ blockId: rejectBlockId, offset: 6 },
			{ blockId: rejectBlockId, offset: 11 },
		);
		const rejectController = getAIController(rejectEditor)!;
		const rejectSession = rejectController.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		await rejectController.runSessionPrompt(
			rejectSession.id,
			"Rewrite the selection",
		);
		const rejectedTurnId = rejectController.getActiveSession()?.turns[0]?.id;

		expect(
			rejectController.resolveSessionTurn(
				rejectSession.id,
				rejectedTurnId!,
				"reject",
			),
		).toBe(true);
		expect(
			rejectController.getActiveSession()?.contextualPrompt?.composer.isOpen,
		).toBe(false);
	});

	it("uses the captured inline session selection even if the editor selection changes", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "planet" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});

		editor.selectTextRange(
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);

		const generation = await controller.runSessionPrompt(
			session.id,
			"Rewrite the selection",
		);

		expect(generation.status).toBe("complete");
		expect(editor.getBlock(blockId)!.textContent({ resolved: true })).toBe(
			"Hello planet",
		);
	});

	it("routes inline session continue prompts to block streaming suggestions", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " More detail" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});

		const generation = await controller.runSessionPrompt(
			session.id,
			"Continue this paragraph",
		);

		expect(generation.target).toBe("selection");
		expect(generation.mutationMode).toBe("streaming-suggestions");
		expect(editor.getBlock(blockId)!.textContent()).toContain("Hello world");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
	});

	it("routes inline local-edit prompts to block streaming suggestions", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " Better version" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});

		const generation = await controller.runSessionPrompt(
			session.id,
			"Make it better",
		);

		expect(generation.target).toBe("selection");
		expect(generation.mutationMode).toBe("streaming-suggestions");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
	});

	it("uses the live collapsed caret offset for block generations", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " AI" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 5 },
			{ blockId, offset: 5 },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Continue this paragraph", {
			target: "block",
			blockId,
		});

		expect(generation.target).toBe("block");
		const suggestions = controller.getSuggestions();
		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions[0]).toMatchObject({
			blockId,
			offset: 5,
		});
	});

	it("uses the selection end as the insertion offset for inline block turns", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " Better" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Make it better",
		);

		expect(generation.target).toBe("selection");
		expect(generation.mutationMode).toBe("streaming-suggestions");
		const suggestions = controller.getSuggestions();
		expect(suggestions.length).toBeGreaterThan(0);
		expect(suggestions[0]?.blockId).toBe(blockId);
	});

	it("creates reviewable cross-block inline edit suggestions", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "X" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply([
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
			{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Hello" },
			{ type: "insert-text", blockId: "b2", offset: 0, text: "World" },
			{ type: "insert-text", blockId: "b3", offset: 0, text: "Again" },
		]);
		editor.selectTextRange(
			{ blockId: firstBlockId, offset: 2 },
			{ blockId: "b3", offset: 2 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Rewrite the selection",
		);
		const nextSession = controller.getActiveSession();
		const turn = nextSession?.turns[0];

		expect(generation.suggestionIds?.length ?? 0).toBeGreaterThan(0);
		expect(turn?.selection?.isMultiBlock).toBe(true);
		expect(turn?.status).toBe("review");
		expect(controller.acceptSessionTurn(session.id, turn!.id)).toBe(true);
		expect(editor.getBlock(firstBlockId)?.textContent({ resolved: true })).toBe("HeXain");
		expect(editor.getBlock("b2")).toBeNull();
		expect(editor.getBlock("b3")).toBeNull();
	});

	it("records progressive tool stream events for the active generation", async () => {
		let pass = 0;
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							pass += 1;
							if (pass === 1) {
								yield {
									type: "tool-call" as const,
									toolCallId: "tool-call-1",
									toolName: "test_search",
									input: { query: "plan" },
								};
							}
							yield { type: "done" as const };
						},
					},
				}),
				testStreamingToolExtension(),
			],
		});
		const controller = getAIController(editor)!;
		const blockId = editor.firstBlock()!.id;

		const generation = await controller.runPrompt("search the document", { blockId });
		const streamEvents = controller.getStreamEvents();
		const streamEventTypes = streamEvents.map((event) => event.type);
		const toolOutputEvents = streamEvents.filter(
			(event) => event.type === "tool-output",
		);
		const toolResultEvent = streamEvents.find(
			(event) => event.type === "tool-result",
		);

		expect(generation.status).toBe("complete");
		expect(streamEventTypes).toEqual([
			"generation-start",
			"status",
			"tool-call",
			"status",
			"tool-output",
			"tool-output",
			"tool-result",
			"status",
			"generation-finish",
		]);
		expect(toolOutputEvents).toHaveLength(2);
		expect(toolOutputEvents[0]).toMatchObject({
			toolCallId: "tool-call-1",
			toolName: "test_search",
			part: "searching:plan",
			output: "searching:plan",
		});
		expect(toolOutputEvents[1]).toMatchObject({
			toolCallId: "tool-call-1",
			toolName: "test_search",
			part: { matches: 2, query: "plan" },
			output: ["searching:plan", { matches: 2, query: "plan" }],
		});
		expect(toolResultEvent).toMatchObject({
			type: "tool-result",
			toolCallId: "tool-call-1",
			toolName: "test_search",
			output: ["searching:plan", { matches: 2, query: "plan" }],
			state: "complete",
		});
	});

	it("streams block structured previews before a block plan finishes", async () => {
		const releaseSecondDelta = createDeferred();
		let streamedBlockId = "";
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta:
									`{"kind":"block_convert","blockId":"${streamedBlockId}","newType":"heading"`,
							};
							await releaseSecondDelta.promise;
							yield {
								type: "text-delta" as const,
								delta: ',"props":{"level":2}}',
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		streamedBlockId = blockId;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generationPromise = controller.runPrompt("Convert block to heading", {
			blockId,
		});
		await waitForPreview(
			() => controller.getState().activeGeneration?.structuredPreview,
		);

		const activeGeneration = controller.getState().activeGeneration;
		const previewEventsBeforeCompletion = controller.getStreamEvents().filter(
			(event) => event.type === "structured-preview",
		);
		expect(activeGeneration?.structuredPreview).toMatchObject({
			planState: "drafted",
			plan: {
				kind: "block_convert",
				blockId,
				newType: "heading",
			},
		});
		expect(activeGeneration?.structuredPreview?.reviewItems).toEqual([
			expect.objectContaining({
				label: "Convert block",
				section: "block",
				changeKind: "updated",
			}),
		]);
		expect(controller.getStreamEvents().some((event) => (
			event.type === "structured-preview" &&
			event.preview.plan.kind === "block_convert"
		))).toBe(true);
		expect(previewEventsBeforeCompletion).toHaveLength(1);
		expect(previewEventsBeforeCompletion[0]).toMatchObject({
			patches: [
				{ op: "add", path: "/planState", value: "drafted" },
				{ op: "add", path: "/plan", value: expect.any(Object) },
				{ op: "add", path: "/reviewItems", value: expect.any(Array) },
				{ op: "add", path: "/targets", value: [] },
			],
		});

		releaseSecondDelta.resolve();
		const generation = await generationPromise;
		const previewEventsAfterCompletion = controller.getStreamEvents().filter(
			(event) => event.type === "structured-preview",
		);
		const finalPreviewEvent =
			previewEventsAfterCompletion[previewEventsAfterCompletion.length - 1];
		expect(generation.structuredPreview).toMatchObject({
			planState: "validated",
			plan: {
				kind: "block_convert",
				blockId,
				newType: "heading",
				props: { level: 2 },
			},
		});
		expect(finalPreviewEvent).toMatchObject({
			patches: [
				{ op: "replace", path: "/planState", value: "validated" },
				{ op: "add", path: "/plan/props", value: {} },
				{ op: "add", path: "/plan/props/level", value: 2 },
			],
		});
		expect(
			finalPreviewEvent?.patches.some((patch) => patch.path === "/plan"),
		).toBe(false);
	});

	it("keeps selection rewrites text-only when markdown block generation is enabled", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: { blockGeneration: "markdown" },
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "# Planet",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Rewrite the selection");

		expect(generation.status).toBe("complete");
		expect(generation.contentFormat).toBe("text");
		expect(editor.getBlock(blockId)!.textContent()).toBe("Hello world# Planet");
		expect(editor.documentState.blockOrder).toHaveLength(1);
	});

	it("routes context-first block edits into persistent suggestions", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " Updated" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Improve this paragraph", { blockId });
		const block = editor.getBlock(blockId)!;

		expect(generation.route).toBe("context-first");
		expect(generation.mutationMode).toBe("persistent-suggestions");
		expect(block.textContent()).toBe("Hello Updated");
		expect(controller.getSuggestions().length).toBeGreaterThan(0);
	});

	it("uses markdown block generation for bottom-chat document writing", async () => {
		const releaseFinalDelta = createDeferred();
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
						selectionRewrite: "text",
					},
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "Once upon " };
							await releaseFinalDelta.promise;
							yield { type: "text-delta" as const, delta: "a time" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		const generationPromise = controller.runSessionPrompt(
			session.id,
			"Write a short story",
			{ target: "document" },
		);

		await waitForPreview(() => {
			const activeGeneration = controller.getState().activeGeneration;
			const streamedVisibleBlockTexts = editor.documentState.blockOrder
				.map((id) => editor.getBlock(id)?.textContent({ resolved: true }) ?? "")
				.filter((text) => text.trim().length > 0);
			return (
				activeGeneration?.surface === "bottom-chat" &&
				activeGeneration.contentFormat === "markdown" &&
				streamedVisibleBlockTexts.includes("Once upon")
			);
		});

		const streamedVisibleBlockTexts = editor.documentState.blockOrder
			.map((id) => editor.getBlock(id)?.textContent({ resolved: true }) ?? "")
			.filter((text) => text.trim().length > 0);

		expect(controller.getState().activeGeneration?.surface).toBe("bottom-chat");
		expect(controller.getState().activeGeneration?.contentFormat).toBe("markdown");
		expect(controller.getState().activeGeneration?.mutationMode).toBe(
			"streaming-suggestions",
		);
		expect(streamedVisibleBlockTexts).toEqual(["Hello", "Once upon"]);
		expect(session.surface).toBe("bottom-chat");

		releaseFinalDelta.resolve();
		const generation = await generationPromise;
		const visibleBlockTexts = editor.documentState.blockOrder
			.map((id) => editor.getBlock(id)?.textContent({ resolved: true }) ?? "")
			.filter((text) => text.trim().length > 0);
		expect(generation.status).toBe("complete");
		expect(generation.mutationMode).toBe("streaming-suggestions");
		expect(generation.contentFormat).toBe("markdown");
		expect(generation.adapterId).toBe("flow-markdown");
		expect(generation.blockClass).toBe("flow");
		expect(generation.transportKind).toBe("flow-text");
		expect(generation.mutationReceipt?.status).toBe("staged_suggestions");
		expect(generation.suggestionIds?.length ?? 0).toBeGreaterThan(0);
		expect(visibleBlockTexts).toEqual(["Hello", "Once upon a time"]);
	});

	it("streams bottom-chat markdown as block suggestions before completion", async () => {
		const releaseFinalDelta = createDeferred();
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
						selectionRewrite: "text",
					},
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "\n\nOnce upon " };
							await releaseFinalDelta.promise;
							yield { type: "text-delta" as const, delta: "a time" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		const generationPromise = controller.runSessionPrompt(
			session.id,
			"Write a short story",
			{ target: "document" },
		);

		await new Promise((resolve) => setTimeout(resolve, 80));

		expect(controller.getState().activeGeneration?.surface).toBe("bottom-chat");
		expect(controller.getState().activeGeneration?.contentFormat).toBe("markdown");
		const visibleStreamingTexts = editor.documentState.blockOrder
			.map((id) => editor.getBlock(id)?.textContent({ resolved: true }) ?? "")
			.filter((text) => text.trim().length > 0);
		expect(
			(editor.getBlock(blockId)?.textContent({ resolved: true }) ?? "").replace(
				/^\u200b/,
				"",
			),
		).toBe("");
		expect(visibleStreamingTexts).toEqual(["Once upon"]);

		releaseFinalDelta.resolve();
		const generation = await generationPromise;
		const visibleBlockTexts = editor.documentState.blockOrder
			.map((id) => editor.getBlock(id)?.textContent({ resolved: true }) ?? "")
			.filter((text) => text.trim().length > 0);

		expect(generation.status).toBe("complete");
		expect(generation.contentFormat).toBe("markdown");
		expect(generation.suggestionIds?.length ?? 0).toBeGreaterThan(0);
		expect(visibleBlockTexts).toEqual(["Once upon a time"]);
	});

	it("trims leading blank lines when bottom-chat writes into an empty block", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
					},
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "\n\nOnce upon a time" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});

		const generation = await controller.runSessionPrompt(
			session.id,
			"Write a short story",
			{ target: "document" },
		);

		const visibleBlockTexts = editor.documentState.blockOrder
			.map((id) => editor.getBlock(id)?.textContent({ resolved: true }) ?? "")
			.filter((text) => text.trim().length > 0);

		expect(generation.status).toBe("complete");
		expect(visibleBlockTexts).toEqual(["Once upon a time"]);
	});

	it("materializes bottom-chat paragraphs as separate blocks for empty targets", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
					},
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "First paragraph.\n\nSecond paragraph.",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});

		const generation = await controller.runSessionPrompt(
			session.id,
			"Write two paragraphs",
			{ target: "document" },
		);

		const visibleBlockTexts = editor.documentState.blockOrder
			.map((id) => editor.getBlock(id)?.textContent({ resolved: true }) ?? "")
			.filter((text) => text.trim().length > 0);

		expect(generation.status).toBe("complete");
		expect(visibleBlockTexts).toEqual([
			"First paragraph.",
			"Second paragraph.",
		]);
	});

	it("reuses a leading empty placeholder for document-target bottom-chat writes", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
					},
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "Story opener.",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const placeholderBlockId = editor.firstBlock()!.id;
		const trailingBlockId = "trailing-block";
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: trailingBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: placeholderBlockId },
				},
				{
					type: "insert-text",
					blockId: trailingBlockId,
					offset: 0,
					text: "Existing content",
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});

		const generation = await controller.runSessionPrompt(
			session.id,
			"Write a short story",
			{ target: "document" },
		);
		const blockOrder = editor.documentState.blockOrder;
		const visibleBlockTexts = blockOrder
			.map((id) => editor.getBlock(id)?.textContent({ resolved: true }) ?? "")
			.filter((text) => text.trim().length > 0);

		expect(generation.status).toBe("complete");
		expect(blockOrder).toHaveLength(3);
		expect(visibleBlockTexts).toEqual(["Story opener.", "Existing content"]);
		expect(readBlockSuggestionMeta(editor.getBlock(placeholderBlockId))?.action).toBe(
			"delete-block",
		);
	});

	it("prefers the caret block over unrelated empty placeholders for document-target writes", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
					},
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "Follow the caret.",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const placeholderBlockId = editor.firstBlock()!.id;
		const caretBlockId = "caret-block";
		editor.apply(
			[
				{
					type: "insert-block",
					blockId: caretBlockId,
					blockType: "paragraph",
					props: {},
					position: { after: placeholderBlockId },
				},
				{
					type: "insert-text",
					blockId: caretBlockId,
					offset: 0,
					text: "Existing content",
				},
			],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId: caretBlockId, offset: 8 },
			{ blockId: caretBlockId, offset: 8 },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});

		const generation = await controller.runSessionPrompt(
			session.id,
			"Write more here",
			{ target: "document" },
		);
		const blockOrder = editor.documentState.blockOrder;
		const visibleBlockTexts = blockOrder
			.map((id) => editor.getBlock(id)?.textContent({ resolved: true }) ?? "")
			.filter((text) => text.trim().length > 0);

		expect(generation.status).toBe("complete");
		expect(blockOrder).toHaveLength(3);
		expect(visibleBlockTexts).toEqual(["Existing content", "Follow the caret."]);
	});

	it("creates tables through markdown for bottom-chat document prompts", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
					},
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "| Tier | Price |\n| --- | --- |\n| Pro | $20 |",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const introBlockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId: introBlockId, offset: 0, text: "Intro" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Create a pricing table",
			{ target: "document" },
		);

		expect(generation.status).toBe("complete");
		expect(generation.contentFormat).toBe("markdown");
		expect(generation.planState).toBe("none");
		expect(generation.reviewItems).toEqual([]);
		expect(generation.adapterId).toBe("flow-markdown");
		expect(generation.blockClass).toBe("flow");
		expect(generation.transportKind).toBe("flow-text");
		expect(generation.mutationMode).toBe("streaming-suggestions");
		expect(generation.mutationReceipt?.status).toBe("staged_suggestions");
		expect(generation.suggestionIds?.length ?? 0).toBeGreaterThan(0);
		const tables = Array.from(editor.blocks("table"));
		expect(tables).toHaveLength(1);
		expect(tables[0]?.tableCell(0, 0)?.textContent()).toBe("Tier");
		expect(tables[0]?.tableCell(0, 1)?.textContent()).toBe("Price");
		expect(tables[0]?.tableCell(1, 0)?.textContent()).toBe("Pro");
		expect(tables[0]?.tableCell(1, 1)?.textContent()).toBe("$20");
		expect(controller.acceptActiveGeneration()).toBe(true);
	});

	it("streams markdown table suggestions before completion for bottom-chat document prompts", async () => {
		const releaseFinalDelta = createDeferred();
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
					},
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta:
									"| First Name | Last Name |\n| --- | --- |\n| Alice | Johnson |",
							};
							await releaseFinalDelta.promise;
							yield {
								type: "text-delta" as const,
								delta: "\n| Bob | Smith |",
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const introBlockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId: introBlockId, offset: 0, text: "Intro" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		const generationPromise = controller.runSessionPrompt(
			session.id,
			"Create a table with names in it",
			{ target: "document" },
		);

		await waitForPreview(() => {
			const tables = Array.from(editor.blocks("table"));
			return tables[0]?.tableCell(1, 0)?.textContent() === "Alice";
		});

		expect(controller.getState().activeGeneration?.adapterId).toBe("flow-markdown");
		expect(controller.getState().activeGeneration?.blockClass).toBe("flow");
		expect(controller.getState().activeGeneration?.transportKind).toBe("flow-text");
		expect(controller.getState().activeGeneration?.mutationMode).toBe(
			"streaming-suggestions",
		);
		const previewTables = Array.from(editor.blocks("table"));
		expect(previewTables).toHaveLength(1);
		expect(previewTables[0]?.tableCell(1, 0)?.textContent()).toBe("Alice");
		expect(previewTables[0]?.tableCell(1, 1)?.textContent()).toBe("Johnson");

		releaseFinalDelta.resolve();
		const generation = await generationPromise;

		expect(generation.planState).toBe("none");
		expect(generation.reviewItems).toEqual([]);
		expect(generation.adapterId).toBe("flow-markdown");
		expect(generation.blockClass).toBe("flow");
		expect(generation.transportKind).toBe("flow-text");
		expect(generation.mutationReceipt?.status).toBe("staged_suggestions");
		const tables = Array.from(editor.blocks("table"));
		expect(tables).toHaveLength(1);
		expect(tables[0]?.tableCell(1, 0)?.textContent()).toBe("Alice");
		expect(tables[0]?.tableCell(1, 1)?.textContent()).toBe("Johnson");
		expect(tables[0]?.tableCell(2, 0)?.textContent()).toBe("Bob");
		expect(tables[0]?.tableCell(2, 1)?.textContent()).toBe("Smith");
	});

	it("builds rich preview details for newly inserted databases during direct bottom-chat apply", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					contentFormat: {
						blockGeneration: "markdown",
					},
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: JSON.stringify({
									kind: "review_bundle",
									label: "Create task database",
									reason: "Insert and seed a task database.",
									plans: [
										{
											kind: "block_insert",
											blockId: "task-db",
											blockType: "database",
											position: "last",
										},
										{
											kind: "database_edit",
											blockId: "task-db",
											steps: [
												{
													op: "insert_row",
													rowId: "row-1",
													values: {
														name: "Ship docs",
														tags: "[\"docs\"]",
														done: "false",
													},
												},
												{
													op: "add_view",
													view: {
														id: "view-list",
														title: "List view",
														type: "list",
														visibleColumnIds: ["name", "tags"],
														columnOrder: ["name", "tags", "done"],
													},
												},
											],
										},
									],
								}),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});

		const controller = getAIController(editor)!;
		const session = controller.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		const generation = await controller.runSessionPrompt(
			session.id,
			"Create a task database table with views",
			{ target: "document" },
		);

		expect(generation.planState).toBe("validated");
		expect(generation.structuredPreview?.targets).toEqual([
			expect.objectContaining({
				blockId: "task-db",
				targetKind: "database",
				database: expect.objectContaining({
					columns: expect.arrayContaining([
						expect.objectContaining({ id: "name" }),
						expect.objectContaining({ id: "tags" }),
						expect.objectContaining({ id: "done" }),
					]),
					rows: [
						expect.objectContaining({
							id: "row-1",
							values: expect.objectContaining({
								name: "Ship docs",
							}),
						}),
					],
					views: expect.arrayContaining([
						expect.objectContaining({ id: "view-table" }),
						expect.objectContaining({ id: "view-list" }),
					]),
				}),
			}),
		]);
		expect(generation.reviewItems).toEqual([]);
		expect(editor.getBlock("task-db")?.type).toBe("database");
	});

	it("replaces existing tables through markdown suggestions", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: [
									"| Name |",
									"| --- |",
									"| Alice |",
									"| Bob |",
								].join("\n"),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: "table-1",
					blockType: "table",
					props: {},
					position: { after: firstBlockId },
				},
			],
			{ origin: "system" },
		);
		const initialRowCount = editor.getBlock("table-1")!.tableRowCount();

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Add a row to this table", {
			blockId: "table-1",
		});

		expect(generation.status).toBe("complete");
		expect(generation.targetKind).toBe("table");
		expect(generation.planState).toBe("none");
		expect(generation.plan).toBeNull();
		expect(generation.adapterId).toBe("flow-markdown");
		expect(generation.transportKind).toBe("flow-text");
		expect(generation.mutationReceipt?.status).toBe("staged_suggestions");
		expect(generation.reviewItems).toEqual([]);
		expect(generation.debug?.structured).toMatchObject({
			plannerMode: "text",
			targetKind: "table",
			validationIssueCount: 0,
		});
		expect(generation.suggestionIds?.length ?? 0).toBeGreaterThan(0);
		expect(editor.getBlock("table-1")?.tableRowCount()).toBe(initialRowCount);
	});

	it("accepts markdown table suggestions through the controller", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: [
									"| Name |",
									"| --- |",
									"| Alice |",
									"| Bob |",
								].join("\n"),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: "table-1",
					blockType: "table",
					props: {},
					position: { after: firstBlockId },
				},
			],
			{ origin: "system" },
		);
		const initialRowCount = editor.getBlock("table-1")!.tableRowCount();

		const controller = getAIController(editor)!;
		await controller.runPrompt("Add a row to this table", {
			blockId: "table-1",
		});

		expect(controller.acceptActiveGeneration()).toBe(true);
		const tables = Array.from(editor.blocks("table"));
		expect(tables).toHaveLength(1);
		expect(tables[0]?.tableRowCount()).toBe(initialRowCount + 1);
		expect(tables[0]?.tableCell(1, 0)?.textContent()).toBe("Alice");
		expect(tables[0]?.tableCell(2, 0)?.textContent()).toBe("Bob");
		expect(controller.getState().activeGeneration?.plan).toBeNull();
		expect(controller.getState().activeGeneration?.reviewItems).toEqual([]);
		expect(controller.getState().activeGeneration?.planState).toBe("none");
	});

	it("rejects markdown table suggestions without mutating the table", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: [
									"| Name |",
									"| --- |",
									"| Alice |",
									"| Bob |",
								].join("\n"),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: "table-1",
					blockType: "table",
					props: {},
					position: { after: firstBlockId },
				},
			],
			{ origin: "system" },
		);
		const initialRowCount = editor.getBlock("table-1")!.tableRowCount();

		const controller = getAIController(editor)!;
		await controller.runPrompt("Add a row to this table", {
			blockId: "table-1",
		});

		expect(controller.rejectActiveGeneration()).toBe(true);
		expect(editor.getBlock("table-1")!.tableRowCount()).toBe(initialRowCount);
		expect(Array.from(editor.blocks("table"))).toHaveLength(1);
		expect(controller.getState().activeGeneration?.plan).toBeNull();
		expect(controller.getState().activeGeneration?.reviewItems).toEqual([]);
		expect(controller.getState().activeGeneration?.planState).toBe("rejected");
	});

	it("applies XML flow patch plans through the markdown fast-apply path", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: [
									"<pen-fast-apply>",
									"<instructions>I am replacing the current table with an updated version.</instructions>",
									"<scope>adjacent-blocks</scope>",
									"<targetSpanId>span:table-1</targetSpanId>",
									"<edit>",
									"<operation>replace_blocks</operation>",
									"<block>table-1</block>",
									"<expectedBlockType>table</expectedBlockType>",
									"<markdown><![CDATA[| Name | Role |",
									"| --- | --- |",
									"| Alice | Design |",
									"| Bob | Engineering |]]></markdown>",
									"</edit>",
									"</pen-fast-apply>",
								].join("\n"),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: "table-1",
					blockType: "table",
					props: {},
					position: { after: firstBlockId },
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Add a role column to this table", {
			blockId: "table-1",
		});

		expect(generation.mutationReceipt?.status).toBe("staged_suggestions");

		expect(controller.acceptActiveGeneration()).toBe(true);
		const tables = Array.from(editor.blocks("table"));
		expect(tables).toHaveLength(1);
		expect(tables[0]?.tableColumnCount()).toBe(2);
		expect(tables[0]?.tableRowCount()).toBe(3);
		expect(tables[0]?.tableCell(1, 1)?.textContent()).toBe("Design");
	});

	it("records flow patch alignment metrics in fast-apply debug state", () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Alpha" },
				{
					type: "insert-block",
					blockId: "block-2",
					blockType: "paragraph",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "insert-text",
					blockId: "block-2",
					offset: 0,
					text: "Bravo",
				},
				{
					type: "insert-block",
					blockId: "block-3",
					blockType: "paragraph",
					props: {},
					position: { after: "block-2" },
				},
				{
					type: "insert-text",
					blockId: "block-3",
					offset: 0,
					text: "Charlie",
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const controllerAny = controller as any;
		controllerAny._state.activeGeneration = {
			id: "test-generation",
			debug: {
				messageAssemblyLatencyMs: 0,
				firstToolStartMs: null,
				firstToolResultMs: null,
				firstVisibleTextMs: null,
				toolExecutionMs: 0,
				qualitySignals: {},
			},
		};

		const mutationReceipt = controllerAny._commitBufferedMarkdownFastApply(
			firstBlockId,
			[
				"<pen-fast-apply>",
				"<instructions>I am inserting a new paragraph between Bravo and Charlie.</instructions>",
				"<scope>adjacent-blocks</scope>",
				`<targetSpanId>span:${firstBlockId}</targetSpanId>`,
				"<edit>",
				"<operation>replace_blocks</operation>",
				`<block>${firstBlockId}</block>`,
				"<block>block-2</block>",
				"<block>block-3</block>",
				"<markdown><![CDATA[Alpha",
				"",
				"Bravo",
				"",
				"Inserted middle",
				"",
				"Charlie]]></markdown>",
				"</edit>",
				"</pen-fast-apply>",
			].join("\n"),
			"persistent-suggestions",
			undefined,
			{
				context: {
					markdown: ["Alpha", "", "Bravo", "", "Charlie"].join("\n"),
					markdownWindow: {
						blockIds: [firstBlockId, "block-2", "block-3"],
					},
				},
			},
		);

		expect(mutationReceipt?.status).toBe("staged_suggestions");
		expect(controller.getState().activeGeneration?.debug?.fastApply).toMatchObject({
			attempted: true,
			succeeded: true,
			executionPath: "native-fast-apply",
			alignment: {
				preservedBlockCount: 3,
				rewrittenBlockCount: 0,
				unchangedBlockCount: 3,
				insertedBlockCount: 1,
				deletedBlockCount: 0,
				estimatedOperationCost: 2,
			},
		});
	});

	it("records scoped replacement fallback metrics in fast-apply debug state", () => {
		const editor = createEditor({
			extensions: [aiExtension({})],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Alpha" },
				{
					type: "insert-block",
					blockId: "block-2",
					blockType: "paragraph",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "insert-text",
					blockId: "block-2",
					offset: 0,
					text: "Charlie",
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const controllerAny = controller as any;
		controllerAny._state.activeGeneration = {
			id: "test-generation",
			debug: {
				messageAssemblyLatencyMs: 0,
				firstToolStartMs: null,
				firstToolResultMs: null,
				firstVisibleTextMs: null,
				toolExecutionMs: 0,
				qualitySignals: {},
			},
		};

		const mutationReceipt = controllerAny._commitBufferedMarkdownFastApply(
			firstBlockId,
			[
				"<pen-fast-apply>",
				"<instructions>I am inserting a middle paragraph.</instructions>",
				"<anchorBefore><![CDATA[Alpha]]></anchorBefore>",
				"<anchorAfter><![CDATA[Charlie]]></anchorAfter>",
				"<patch><![CDATA[<!-- ... existing markdown ... -->",
				"",
				"Bravo",
				"",
				"<!-- ... existing markdown ... -->]]></patch>",
				"</pen-fast-apply>",
			].join("\n"),
			"persistent-suggestions",
			undefined,
			{
				context: {
					markdown: ["Alpha", "", "Charlie"].join("\n"),
					markdownWindow: {
						blockIds: [firstBlockId, "block-2"],
					},
				},
			},
		);

		expect(mutationReceipt?.status).toBe("staged_suggestions");
		expect(controller.getState().activeGeneration?.debug?.fastApply).toMatchObject({
			attempted: true,
			succeeded: true,
			executionPath: "scoped-replacement",
			fallback: {
				kind: "scoped-replacement",
				opsCount: 8,
				insertedBlockCount: 3,
				deletedBlockCount: 2,
				targetBlockCount: 2,
			},
		});
	});

	it("records plain markdown fallback metrics when fast-apply falls back to block generation", () => {
		const editor = createEditor({
			extensions: [aiExtension({ contentFormat: { blockGeneration: "markdown" } })],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Hello" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const controllerAny = controller as any;
		controllerAny._state.activeGeneration = {
			id: "test-generation",
			debug: {
				messageAssemblyLatencyMs: 0,
				firstToolStartMs: null,
				firstToolResultMs: null,
				firstVisibleTextMs: null,
				toolExecutionMs: 0,
				qualitySignals: {},
			},
		};

		const mutationReceipt = controllerAny._commitBufferedBlockGeneration(
			firstBlockId,
			"## Replacement title",
			"persistent-suggestions",
			"markdown",
			undefined,
			{
				applyStrategy: "markdown-fast-apply",
				workingSet: {
					context: {
						markdown: "Hello",
						markdownWindow: {
							blockIds: [firstBlockId],
						},
					},
				},
			},
		);

		expect(mutationReceipt?.status).toBe("staged_suggestions");
		expect(controller.getState().activeGeneration?.debug?.fastApply).toMatchObject({
			attempted: true,
			succeeded: false,
			fallbackReason: "unparseable-contract",
			executionPath: "plain-markdown",
			fallback: {
				kind: "plain-markdown",
				opsCount: 2,
				insertedBlockCount: 1,
				deletedBlockCount: 0,
			},
		});
	});

	it("executes review-safe block convert plans through the existing suggestion path", async () => {
		let blockId = "";
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: JSON.stringify({
									kind: "block_convert",
									blockId,
									newType: "heading",
									props: { level: 2 },
								}),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello" }],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Convert block to heading", {
			blockId,
		});
		const block = editor.getBlock(blockId)!;

		expect(generation.planState).toBe("validated");
		expect(generation.plan).toMatchObject({
			kind: "block_convert",
			blockId,
			newType: "heading",
		});
		expect(block.type).toBe("heading");
		expect(block.meta("suggestion")).toMatchObject({
			action: "convert-block",
			authorType: "ai",
		});
	});

	it("keeps the controller state snapshot stable for no-op updates", () => {
		const editor = createEditor({
			extensions: [aiExtension()],
		});

		const controller = getAIController(editor)!;
		const initialState = controller.getState();

		controller.setSuggestMode(false);
		expect(controller.getState()).toBe(initialState);

		controller.closeCommandMenu();
		expect(controller.getState()).toBe(initialState);

		controller.dismissEphemeralSuggestion();
		expect(controller.getState()).toBe(initialState);
	});

	it("builds database review items with before and after cell previews", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: JSON.stringify({
									kind: "database_edit",
									blockId: "database-1",
									steps: [
										{
											op: "update_cell",
											rowId: "row-1",
											columnId: "name",
											value: "Beta",
										},
									],
								}),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: "database-1",
					blockType: "database",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "database-insert-row",
					blockId: "database-1",
					rowId: "row-1",
					values: {
						name: "Alpha",
						tags: "[]",
						done: "false",
					},
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Update this database cell", {
			blockId: "database-1",
		});

		expect(generation.reviewItems).toEqual([
			expect.objectContaining({
				label: "Update cell",
				changeKind: "updated",
				section: "cell",
				detail: "Alpha · Name",
				before: "Alpha",
				after: "Beta",
			}),
		]);
	});

	it("keeps accepted structured review items in document undo history", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: JSON.stringify({
									kind: "database_edit",
									blockId: "database-1",
									steps: [
										{
											op: "update_cell",
											rowId: "row-1",
											columnId: "name",
											value: "Beta",
										},
									],
								}),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: "database-1",
					blockType: "database",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "database-insert-row",
					blockId: "database-1",
					rowId: "row-1",
					values: {
						name: "Alpha",
						tags: "[]",
						done: "false",
					},
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Update this database cell", {
			blockId: "database-1",
		});
		const reviewItems = generation.reviewItems ?? [];
		const reviewItemIds = reviewItems.map((item) => item.id);

		expect(generation.planState).toBe("validated");
		expect(reviewItems).toHaveLength(1);
		expect(reviewItemIds).toHaveLength(1);

		expect(controller.acceptReviewItems(reviewItemIds)).toBe(true);
		expect(editor.getBlock("database-1")!.tableCell(0, 0)?.textContent()).toBe(
			"Beta",
		);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock("database-1")!.tableCell(0, 0)?.textContent()).toBe(
			"Alpha",
		);

		expect(editor.undoManager.redo()).toBe(true);
		expect(editor.getBlock("database-1")!.tableCell(0, 0)?.textContent()).toBe(
			"Beta",
		);
	});

	it("treats structured review rejection as non-mutating UI state", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: JSON.stringify({
									kind: "database_edit",
									blockId: "database-1",
									steps: [
										{
											op: "update_cell",
											rowId: "row-1",
											columnId: "name",
											value: "Beta",
										},
									],
								}),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: "database-1",
					blockType: "database",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "database-insert-row",
					blockId: "database-1",
					rowId: "row-1",
					values: {
						name: "Alpha",
						tags: "[]",
						done: "false",
					},
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Update this database cell", {
			blockId: "database-1",
		});
		const reviewItems = generation.reviewItems ?? [];
		const reviewItemIds = reviewItems.map((item) => item.id);

		expect(reviewItemIds).toHaveLength(1);
		expect(controller.rejectReviewItems(reviewItemIds)).toBe(true);
		expect(editor.getBlock("database-1")!.tableCell(0, 0)?.textContent()).toBe(
			"Alpha",
		);
		expect(editor.undoManager.canUndo()).toBe(false);
		expect(editor.undoManager.undo()).toBe(false);
		expect(controller.getState().activeGeneration?.planState).toBe("rejected");
		expect(controller.getState().activeGeneration?.reviewItems).toEqual([]);
	});

	it("keeps accepted structured review artifacts transient across history replay", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: JSON.stringify({
									kind: "database_edit",
									blockId: "database-1",
									steps: [
										{
											op: "update_cell",
											rowId: "row-1",
											columnId: "name",
											value: "Beta",
										},
									],
								}),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: "database-1",
					blockType: "database",
					props: {},
					position: { after: firstBlockId },
				},
				{
					type: "database-insert-row",
					blockId: "database-1",
					rowId: "row-1",
					values: {
						name: "Alpha",
						tags: "[]",
						done: "false",
					},
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Update this database cell", {
			blockId: "database-1",
		});
		const reviewItems = generation.reviewItems ?? [];
		const reviewItemIds = reviewItems.map((item) => item.id);

		expect(reviewItemIds).toHaveLength(1);
		expect(controller.acceptReviewItems(reviewItemIds)).toBe(true);
		expect(controller.getState().activeGeneration?.planState).toBe("none");
		expect(controller.getState().activeGeneration?.reviewItems).toEqual([]);

		expect(editor.undoManager.undo()).toBe(true);
		expect(editor.getBlock("database-1")!.tableCell(0, 0)?.textContent()).toBe(
			"Alpha",
		);
		expect(controller.getState().activeGeneration?.planState).toBe("none");
		expect(controller.getState().activeGeneration?.reviewItems).toEqual([]);

		expect(editor.undoManager.redo()).toBe(true);
		expect(editor.getBlock("database-1")!.tableCell(0, 0)?.textContent()).toBe(
			"Beta",
		);
		expect(controller.getState().activeGeneration?.planState).toBe("none");
		expect(controller.getState().activeGeneration?.reviewItems).toEqual([]);
	});

	it("builds comparison rows for database view changes", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: JSON.stringify({
									kind: "database_edit",
									blockId: "database-1",
									steps: [
										{
											op: "add_view",
											view: {
												id: "view-list",
												title: "List view",
												type: "list",
												visibleColumnIds: ["name", "tags"],
												columnOrder: ["name", "tags", "done"],
												sort: [{ columnId: "name", direction: "asc" }],
												filter: null,
												groupBy: "tags",
												pageIndex: 0,
												pageSize: 50,
											},
										},
									],
								}),
							};
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		editor.apply(
			[
				{ type: "insert-text", blockId: firstBlockId, offset: 0, text: "Intro" },
				{
					type: "insert-block",
					blockId: "database-1",
					blockType: "database",
					props: {},
					position: { after: firstBlockId },
				},
			],
			{ origin: "system" },
		);

		const controller = getAIController(editor)!;
		const generation = await controller.runPrompt("Add a grouped list view", {
			blockId: "database-1",
		});

		expect(generation.reviewItems).toEqual([
			expect.objectContaining({
				label: "Add view",
				comparisonRows: expect.arrayContaining([
					expect.objectContaining({
						label: "View",
						after: "List view",
						changeKind: "added",
						section: "view",
					}),
					expect.objectContaining({
						label: "Group by",
						after: "Tags",
						changeKind: "updated",
						section: "view",
					}),
					expect.objectContaining({
						label: "Visible columns",
						after: "Name, Tags",
						changeKind: "updated",
						section: "view",
					}),
				]),
			}),
		]);
	});
});
