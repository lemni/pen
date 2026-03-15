import { describe, expect, it } from "vitest";
import {
	createEditor,
	getInlineCompletionController,
} from "@pen/core";
import { FIELD_EDITOR_SLOT_KEY, defineExtension } from "@pen/types";
import {
	autocompleteExtension,
	createAutocompleteProvider,
	getAutocompleteController,
} from "../index";

async function waitForCondition(
	check: () => boolean,
	maxTicks = 20,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (check()) {
			return;
		}
		await Promise.resolve();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	throw new Error("Condition was not met in time.");
}

describe("@pen/ai-autocomplete", () => {
	it("includes registered provider context in autocomplete prompts", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let firstPrompt = "";
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					providers: [
						createAutocompleteProvider({
							id: "route-hint",
							describe: () => ({
								id: "route-hint",
								description: "Adds the current route to autocomplete context",
								kind: "consumer",
							}),
							provide: () => "route=/settings/profile",
						}),
					],
					model: {
						async *stream(options) {
							if (!firstPrompt) {
								firstPrompt = String(options.messages[1]?.content ?? "");
							}
							yield { type: "text-delta" as const, delta: " world from pen" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(() => firstPrompt.length > 0);

		expect(firstPrompt).toContain('prefix="Hello"');
		expect(firstPrompt).toContain("[provider:route-hint]");
		expect(firstPrompt).toContain("route=/settings/profile");
		expect(
			controller?.listProviderDescriptors().some((descriptor) =>
				descriptor.id === "route-hint"),
		).toBe(true);
		expect(controller?.getState().metrics.requestCount).toBe(1);
		expect(controller?.getState().metrics.successCount).toBe(1);
		expect(controller?.getState().metrics.explicitTabTriggerCount).toBe(1);
		expect(controller?.getState().providerTimings).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					id: "route-hint",
					chars: "route=/settings/profile".length,
				}),
			]),
		);

		editor.destroy();
	});

	it("strips echoed prefix text from end-of-block completions", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "print('hello')" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "pri" }]);
		editor.selectText(blockId, 3, 3);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.text === "nt('hello')",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("print('hello')");

		editor.destroy();
	});

	it("strips wrapped quotes and stray leading punctuation from prose completions", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: '", tired from a long day at work, but happy to be back."',
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "He came home ",
			},
		]);
		editor.selectText(blockId, 13, 13);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				"tired from a long day at work, but happy to be back.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"He came home tired from a long day at work, but happy to be back.",
		);

		editor.destroy();
	});

	it("drops stray continuation commas after sentence-ending punctuation", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: ", but happy to be back.",
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "He came home.",
			},
		]);
		editor.selectText(blockId, 13, 13);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" But happy to be back.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"He came home. But happy to be back.",
		);

		editor.destroy();
	});

	it("capitalizes prose continuations after sentence-ending punctuation", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "so he decided to relax by watching some TV.",
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([
			{
				type: "insert-text",
				blockId,
				offset: 0,
				text: "He came home tired from a long day at work. ",
			},
		]);
		editor.selectText(blockId, 44, 44);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				"So he decided to relax by watching some TV.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"He came home tired from a long day at work. So he decided to relax by watching some TV.",
		);

		editor.destroy();
	});

	it("accepts the whole visible suggestion and places the caret at the end", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " world from pen" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(
							FIELD_EDITOR_SLOT_KEY,
							fieldEditor,
						);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([
			{ type: "insert-text", blockId, offset: 0, text: "Hello" },
		]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller).toBeTruthy();
		expect(inlineCompletion).toBeTruthy();

		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" world from pen",
		);

		expect(controller?.getState().sequence).toMatchObject({
			acceptedSegments: 0,
			remainingSegments: 1,
			totalSegments: 1,
		});

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world from pen");
		expect(editor.selection).toMatchObject({
			type: "text",
			isCollapsed: true,
			focus: {
				blockId,
				offset: 20,
			},
		});
		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();
		expect(controller?.getState().sequence).toBeNull();

		editor.destroy();
	});

	it("anchors end-of-line suggestions to the previous character for rendering", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " world!" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.text === " world!",
		);

		expect(inlineCompletion?.buildDecorations()).toEqual([
			expect.objectContaining({
				blockId,
				from: 4,
				to: 5,
				attributes: expect.objectContaining({
					"data-suggestion-placement": "after",
				}),
			}),
		]);

		editor.destroy();
	});

	it("adds a separating space to prose suggestions when the model omits it", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "today, with more detail" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello there" }]);
		editor.selectText(blockId, 11, 11);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" today, with more detail",
		);

		editor.destroy();
	});

	it("rejects short single-word prose suggestions", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "friend" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello there" }]);
		editor.selectText(blockId, 11, 11);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(() => controller?.getState().status === "idle");

		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();
		expect(controller?.getState().visibleSuggestionId).toBeNull();

		editor.destroy();
	});

	it("accepts the full remaining completion in one step when full acceptance is enabled", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					acceptanceStrategy: "full",
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " world from pen" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.text === " world from pen",
		);

		expect(controller?.getState().settings.acceptanceStrategy).toBe("full");
		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world from pen");
		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();
		expect(controller?.getState().sequence).toBeNull();
		expect(controller?.getState().metrics.acceptCount).toBe(1);
		expect(controller?.getState().metrics.partialAcceptCount).toBe(0);

		editor.destroy();
	});

	it("keeps scheduled requests alive across selection sync events", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 10,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " world from pen" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request()).toBe(true);
		expect(controller?.getState().status).toBe("scheduled");

		editor.selectText(blockId, 5, 5);

		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.text === " world from pen",
		);
		expect(controller?.getState().metrics.successCount).toBe(1);

		editor.destroy();
	});

	it("dismisses visible suggestions when the selection changes after showing", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " world from pen" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.text === " world from pen",
		);

		editor.selectText(blockId, 0, 0);

		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"selection-change",
		);

		editor.destroy();
	});

	it("keeps visible suggestions when selection-change keeps the same caret", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " world from pen" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.text === " world from pen",
		);

		editor.selectText(blockId, 5, 5);

		expect(inlineCompletion?.getState().visibleSuggestion?.text).toBe(
			" world from pen",
		);
		expect(controller?.getState().visibleSuggestionId).not.toBeNull();
		expect(controller?.getState().status).toBe("showing");

		editor.destroy();
	});

	it("drops stale results and records the stale dismissal reason", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					staleAfterMs: 1,
					model: {
						async *stream() {
							await new Promise((resolve) => setTimeout(resolve, 5));
							yield { type: "text-delta" as const, delta: " world from pen" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => controller?.getState().metrics.staleDropCount === 1,
		);

		expect(controller?.getState().visibleSuggestionId).toBeNull();
		expect(controller?.getState().diagnostics.lastDismissReason).toBe("stale");

		editor.destroy();
	});

	it("blocks requests in code blocks when the block policy disables them", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let modelCalled = false;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: null,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					blockPolicy: {
						allowInCodeBlocks: false,
					},
					model: {
						async *stream() {
							modelCalled = true;
							yield { type: "text-delta" as const, delta: " never runs" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: codeBlockId,
				offset: 0,
				text: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(false);
		expect(modelCalled).toBe(false);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"code-block-disabled",
		);

		editor.destroy();
	});

	it("respects allowed block type policies before scheduling a request", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let modelCalled = false;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: null,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					blockPolicy: {
						allowedBlockTypes: ["heading"],
					},
					model: {
						async *stream() {
							modelCalled = true;
							yield { type: "text-delta" as const, delta: " blocked" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(false);
		expect(modelCalled).toBe(false);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"block-type-not-allowed",
		);

		editor.destroy();
	});

	it("updates block policy at runtime without recreating the controller", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let modelCalled = false;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: null,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					blockPolicy: {
						allowInCodeBlocks: false,
					},
					model: {
						async *stream() {
							modelCalled = true;
							yield { type: "text-delta" as const, delta: " value" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: codeBlockId,
				offset: 0,
				text: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.getState().blockPolicy.allowInCodeBlocks).toBe(false);
		expect(controller?.request({ explicit: true })).toBe(false);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"code-block-disabled",
		);

		controller?.updateBlockPolicy({ allowInCodeBlocks: true });
		expect(controller?.getState().blockPolicy.allowInCodeBlocks).toBe(true);
		expect(controller?.getBlockPolicy().allowInCodeBlocks).toBe(true);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(() => modelCalled);

		editor.destroy();
	});

	it("cancels a scheduled request when runtime policy becomes ineligible", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let modelCalled = false;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: null,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 50,
					model: {
						async *stream() {
							modelCalled = true;
							yield { type: "text-delta" as const, delta: " value" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: codeBlockId,
				offset: 0,
				text: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.request()).toBe(true);
		expect(controller?.getState().status).toBe("scheduled");

		controller?.updateBlockPolicy({ allowInCodeBlocks: false });
		await new Promise((resolve) => setTimeout(resolve, 70));

		expect(modelCalled).toBe(false);
		expect(controller?.getState().status).toBe("idle");
		expect(controller?.getState().visibleSuggestionId).toBeNull();
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"policy-change",
		);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"code-block-disabled",
		);
		expect(controller?.getState().diagnostics.lastPolicyInvalidationStage).toBe(
			"scheduled",
		);
		expect(controller?.getState().metrics.policyInvalidationScheduledCount).toBe(1);
		expect(controller?.getState().metrics.policyInvalidationRequestingCount).toBe(0);
		expect(controller?.getState().metrics.policyInvalidationShowingCount).toBe(0);

		controller?.updateBlockPolicy({ allowInCodeBlocks: true });
		expect(controller?.request({ explicit: true })).toBe(true);
		expect(controller?.getState().diagnostics.lastPolicyInvalidationStage).toBeNull();

		editor.destroy();
	});

	it("cancels an in-flight request when runtime policy becomes ineligible", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let streamStarted = false;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: null,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							streamStarted = true;
							await new Promise((resolve) => setTimeout(resolve, 20));
							yield { type: "text-delta" as const, delta: " value" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: codeBlockId,
				offset: 0,
				text: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(() => streamStarted);
		expect(controller?.getState().status).toBe("requesting");

		controller?.updateBlockPolicy({ allowInCodeBlocks: false });
		await new Promise((resolve) => setTimeout(resolve, 30));

		expect(controller?.getState().status).toBe("idle");
		expect(controller?.getState().visibleSuggestionId).toBeNull();
		expect(controller?.getState().metrics.successCount).toBe(0);
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"policy-change",
		);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"code-block-disabled",
		);
		expect(controller?.getState().diagnostics.lastPolicyInvalidationStage).toBe(
			"requesting",
		);
		expect(controller?.getState().metrics.policyInvalidationScheduledCount).toBe(0);
		expect(controller?.getState().metrics.policyInvalidationRequestingCount).toBe(1);
		expect(controller?.getState().metrics.policyInvalidationShowingCount).toBe(0);

		editor.destroy();
	});

	it("dismisses a visible suggestion when runtime policy becomes ineligible", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: null,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: " value" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const firstBlockId = editor.firstBlock()!.id;
		const codeBlockId = crypto.randomUUID();
		editor.apply([
			{
				type: "insert-block",
				blockId: codeBlockId,
				blockType: "codeBlock",
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: codeBlockId,
				offset: 0,
				text: "const answer =",
			},
		]);
		fieldEditor.focusBlockId = codeBlockId;
		editor.selectText(codeBlockId, 14, 14);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => controller?.getState().visibleSuggestionId !== null,
		);

		controller?.updateBlockPolicy({ allowInCodeBlocks: false });

		expect(controller?.getState().visibleSuggestionId).toBeNull();
		expect(controller?.getState().status).toBe("idle");
		expect(controller?.hasVisibleSuggestion()).toBe(false);
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"policy-change",
		);
		expect(controller?.getState().diagnostics.lastPolicyInvalidationStage).toBe(
			"showing",
		);
		expect(controller?.getState().metrics.policyInvalidationScheduledCount).toBe(0);
		expect(controller?.getState().metrics.policyInvalidationRequestingCount).toBe(0);
		expect(controller?.getState().metrics.policyInvalidationShowingCount).toBe(1);

		const controllerImpl = controller as unknown as {
			_state: {
				blockPolicy: {
					allowInCodeBlocks?: boolean;
					allowInTables?: boolean;
					allowedBlockTypes?: readonly string[];
					deniedBlockTypes?: readonly string[];
				};
			};
			_sequence: {
				requestId: string;
				blockId: string;
				startOffset: number;
				segments: readonly string[];
				acceptedSegmentCount: number;
			} | null;
			_setState: (nextState: {
				status: "showing";
				activeRequestId: string;
				visibleSuggestionId: string;
				sequence: {
					totalSegments: number;
					acceptedSegments: number;
					remainingSegments: number;
				};
			}) => void;
		};
		controllerImpl._state.blockPolicy = {
			...controller!.getBlockPolicy(),
			allowInCodeBlocks: false,
		};
		controllerImpl._sequence = {
			requestId: "manual-policy-recheck",
			blockId: codeBlockId,
			startOffset: 14,
			segments: [" value"],
			acceptedSegmentCount: 0,
		};
		controllerImpl._setState({
			status: "showing",
			activeRequestId: "manual-policy-recheck",
			visibleSuggestionId: "manual-policy-recheck",
			sequence: {
				totalSegments: 1,
				acceptedSegments: 0,
				remainingSegments: 1,
			},
		});
		expect(controller?.acceptVisibleSuggestion()).toBe(false);
		expect(controller?.getState().metrics.policyInvalidationShowingCount).toBe(2);
		expect(controller?.getState().diagnostics.lastDismissReason).toBe(
			"policy-change",
		);

		editor.destroy();
	});

	it("blocks table-cell autocomplete when tables are disabled", () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let modelCalled = false;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
			activeCellCoord: { blockId: "table-1", row: 0, col: 0 },
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					blockPolicy: {
						allowInTables: false,
					},
					model: {
						async *stream() {
							modelCalled = true;
							yield { type: "text-delta" as const, delta: " cell" };
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});

		editor.apply([
			{
				type: "insert-block",
				blockId: "table-1",
				blockType: "table",
				props: {},
				position: "last",
			},
		]);
		fieldEditor.focusBlockId = "table-1";
		editor.selectText("table-1", 0, 0);

		const controller = getAutocompleteController(editor);
		expect(controller?.request({ explicit: true })).toBe(false);
		expect(modelCalled).toBe(false);
		expect(controller?.getState().diagnostics.lastBlockedReason).toBe(
			"table-disabled",
		);

		editor.destroy();
	});

	it("returns defensive block policy snapshots from both getters", () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					blockPolicy: {
						allowedBlockTypes: ["paragraph"],
						deniedBlockTypes: ["database"],
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});

		const controller = getAutocompleteController(editor);
		const snapshot = controller?.getBlockPolicy();
		const stateSnapshot = controller?.getState();
		expect(snapshot).toEqual({
			allowInCodeBlocks: true,
			allowInTables: false,
			allowedBlockTypes: ["paragraph"],
			deniedBlockTypes: ["database"],
		});

		expect(() => {
			if (snapshot?.allowedBlockTypes) {
				(snapshot.allowedBlockTypes as string[]).push("heading");
			}
		}).toThrow();
		expect(() => {
			if (stateSnapshot?.blockPolicy.allowedBlockTypes) {
				(stateSnapshot.blockPolicy.allowedBlockTypes as string[]).push("callout");
			}
		}).toThrow();

		expect(controller?.getBlockPolicy().allowedBlockTypes).toEqual(["paragraph"]);
		expect(controller?.getState().blockPolicy.allowedBlockTypes).toEqual([
			"paragraph",
		]);
		expect(stateSnapshot?.diagnostics.lastPolicyInvalidationStage).toBeNull();
		expect(stateSnapshot?.metrics.policyInvalidationScheduledCount).toBe(0);

		editor.destroy();
	});

	it("returns stable cached snapshots until controller state changes", () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					blockPolicy: {
						allowedBlockTypes: ["paragraph"],
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});

		const controller = getAutocompleteController(editor);
		const firstSnapshot = controller?.getSnapshot();
		const secondSnapshot = controller?.getSnapshot();
		const firstState = controller?.getState();
		const secondState = controller?.getState();
		const firstPolicy = controller?.getBlockPolicy();
		const secondPolicy = controller?.getBlockPolicy();
		const firstProviders = controller?.listProviderDescriptors();
		const secondProviders = controller?.listProviderDescriptors();

		expect(firstSnapshot).toBe(secondSnapshot);
		expect(firstState).toBe(secondState);
		expect(firstPolicy).toBe(secondPolicy);
		expect(firstProviders).toBe(secondProviders);
		expect(firstSnapshot?.state).toBe(firstState);
		expect(firstSnapshot?.state.blockPolicy).toBe(firstPolicy);
		expect(firstSnapshot?.providerDescriptors).toBe(firstProviders);

		controller?.updateBlockPolicy({ allowInCodeBlocks: false });

		const thirdSnapshot = controller?.getSnapshot();
		const thirdState = controller?.getState();
		const thirdPolicy = controller?.getBlockPolicy();

		expect(thirdSnapshot).not.toBe(firstSnapshot);
		expect(thirdState).not.toBe(firstState);
		expect(thirdPolicy).not.toBe(firstPolicy);
		expect(thirdSnapshot?.state).toBe(thirdState);
		expect(thirdSnapshot?.state.blockPolicy).toBe(thirdPolicy);
		expect(thirdSnapshot?.providerDescriptors).toBe(firstProviders);
		expect(thirdState?.blockPolicy.allowInCodeBlocks).toBe(false);
		expect(thirdPolicy?.allowInCodeBlocks).toBe(false);

		editor.destroy();
	});

	it("prefetches a continuation after accepting the current suggestion", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let callCount = 0;
		let secondPrompt = "";
		let thirdPrompt = "";
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					prefetchAfterAccept: true,
					model: {
						async *stream(options) {
							callCount += 1;
							if (callCount === 1) {
								yield { type: "text-delta" as const, delta: " world from pen" };
								yield { type: "done" as const };
								return;
							}
							if (callCount === 2) {
								secondPrompt = String(options.messages[1]?.content ?? "");
								yield {
									type: "text-delta" as const,
									delta:
										". Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell.",
								};
								yield { type: "done" as const };
								return;
							}
							if (callCount === 3) {
								thirdPrompt = String(options.messages[1]?.content ?? "");
								yield {
									type: "text-delta" as const,
									delta:
										" The photos alone could fill a journal.\n\nYou should turn the trip into a full essay while the details are still vivid.\n\nStart with the beach at sunset and the best meal of the week.",
								};
								yield { type: "done" as const };
								return;
							}
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Hello" }]);
		editor.selectText(blockId, 5, 5);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.text === " world from pen",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				". Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell.",
		);
		expect(editor.getBlock(blockId)?.textContent()).toBe("Hello world from pen");
		expect(secondPrompt).toContain('prefix="Hello world from pen"');
		expect(secondPrompt).toContain("target_scope=finish-paragraph");
		expect(inlineCompletion?.getState().visibleSuggestion?.text).toBe(
			". Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" The photos alone could fill a journal.",
		);
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"Hello world from pen. Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell.",
		);
		expect(thirdPrompt).toContain(
			'prefix="Hello world from pen. Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell."',
		);
		expect(thirdPrompt).toContain("target_scope=continue-across-paragraphs");
		expect(inlineCompletion?.getState().visibleSuggestion?.previewBlocks).toEqual([
			expect.objectContaining({
				text: "You should turn the trip into a full essay while the details are still vivid.",
				blockType: "paragraph",
			}),
			expect.objectContaining({
				text: "Start with the beach at sunset and the best meal of the week.",
				blockType: "paragraph",
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		const secondBlock = editor.getBlock(blockId)?.next;
		const thirdBlock = secondBlock?.next;
		expect(secondBlock).toBeTruthy();
		expect(thirdBlock).toBeTruthy();
		expect(editor.getBlock(blockId)?.textContent()).toBe(
			"Hello world from pen. Hope you had a lovely vacation in Ibiza last week and came back with great stories to tell. The photos alone could fill a journal.",
		);
		expect(secondBlock?.textContent()).toBe(
			"You should turn the trip into a full essay while the details are still vivid.",
		);
		expect(thirdBlock?.textContent()).toBe(
			"Start with the beach at sunset and the best meal of the week.",
		);
		expect(editor.selection).toMatchObject({
			type: "text",
			isCollapsed: true,
			focus: {
				blockId: thirdBlock?.id,
				offset: 61,
			},
		});
		expect(inlineCompletion?.getState().visibleSuggestion).toBeNull();

		editor.destroy();
	});

	it("accepts markdown continuation tails as structured blocks", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: " with a plan\n- Book flights\n- Reserve the hotel",
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Trip" }]);
		editor.selectText(blockId, 4, 4);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.text === " with a plan",
		);

		expect(inlineCompletion?.getState().visibleSuggestion?.previewBlocks).toEqual([
			expect.objectContaining({
				text: "Book flights",
				blockType: "bulletListItem",
			}),
			expect.objectContaining({
				text: "Reserve the hotel",
				blockType: "bulletListItem",
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);

		const secondBlock = editor.getBlock(blockId)?.next;
		const thirdBlock = secondBlock?.next;
		expect(editor.getBlock(blockId)?.textContent()).toBe("Trip with a plan");
		expect(secondBlock?.type).toBe("bulletListItem");
		expect(secondBlock?.textContent()).toBe("Book flights");
		expect(thirdBlock?.type).toBe("bulletListItem");
		expect(thirdBlock?.textContent()).toBe("Reserve the hotel");
		expect(editor.selection).toMatchObject({
			type: "text",
			isCollapsed: true,
			focus: {
				blockId: thirdBlock?.id,
				offset: 17,
			},
		});

		editor.destroy();
	});

	it("preserves a leading newline when a continuation starts with markdown blocks", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: "\n- Book flights\n- Reserve the hotel",
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Trip plan" }]);
		editor.selectText(blockId, 9, 9);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.previewBlocks?.length === 2,
		);

		expect(inlineCompletion?.getState().visibleSuggestion?.text).toBe("");
		expect(inlineCompletion?.getState().visibleSuggestion?.previewBlocks).toEqual([
			expect.objectContaining({
				text: "Book flights",
				blockType: "bulletListItem",
			}),
			expect.objectContaining({
				text: "Reserve the hotel",
				blockType: "bulletListItem",
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);

		const secondBlock = editor.getBlock(blockId)?.next;
		const thirdBlock = secondBlock?.next;
		expect(editor.getBlock(blockId)?.textContent()).toBe("Trip plan");
		expect(secondBlock?.type).toBe("bulletListItem");
		expect(secondBlock?.textContent()).toBe("Book flights");
		expect(thirdBlock?.type).toBe("bulletListItem");
		expect(thirdBlock?.textContent()).toBe("Reserve the hotel");

		editor.destroy();
	});

	it("builds continuation context from the newly inserted block after structured accept", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let callCount = 0;
		let secondPrompt = "";
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					prefetchAfterAccept: true,
					model: {
						async *stream(options) {
							callCount += 1;
							if (callCount === 1) {
								yield {
									type: "text-delta" as const,
									delta: "\n- Book flights",
								};
								yield { type: "done" as const };
								return;
							}
							if (callCount === 2) {
								secondPrompt = String(options.messages[1]?.content ?? "");
								yield {
									type: "text-delta" as const,
									delta: "\n- Reserve the hotel",
								};
								yield { type: "done" as const };
								return;
							}
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Trip plan" }]);
		editor.selectText(blockId, 9, 9);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.previewBlocks?.length === 1,
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.previewBlocks?.[0]?.text ===
				"Reserve the hotel",
		);

		expect(secondPrompt).toContain("block_type=bulletListItem");
		expect(secondPrompt).toContain('prefix="Book flights"');

		editor.destroy();
	});

	it("treats multiline prose continuations as appended paragraph blocks", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta:
									" with notes\nBook flights this week.\nReserve the hotel before Friday.",
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{ type: "insert-text", blockId, offset: 0, text: "Trip plan" }]);
		editor.selectText(blockId, 9, 9);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() => inlineCompletion?.getState().visibleSuggestion?.text === " with notes",
		);

		expect(inlineCompletion?.getState().visibleSuggestion?.previewBlocks).toEqual([
			expect.objectContaining({
				text: "Book flights this week.",
				blockType: "paragraph",
			}),
			expect.objectContaining({
				text: "Reserve the hotel before Friday.",
				blockType: "paragraph",
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);

		const secondBlock = editor.getBlock(blockId)?.next;
		const thirdBlock = secondBlock?.next;
		expect(editor.getBlock(blockId)?.textContent()).toBe("Trip plan with notes");
		expect(secondBlock?.type).toBe("paragraph");
		expect(secondBlock?.textContent()).toBe("Book flights this week.");
		expect(thirdBlock?.type).toBe("paragraph");
		expect(thirdBlock?.textContent()).toBe("Reserve the hotel before Friday.");

		editor.destroy();
	});

	it("converts deep single-line prose continuations into appended paragraph blocks", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let callCount = 0;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					prefetchAfterAccept: true,
					model: {
						async *stream() {
							callCount += 1;
							if (callCount === 1) {
								yield {
									type: "text-delta" as const,
									delta: " find his family waiting for him.",
								};
								yield { type: "done" as const };
								return;
							}
							if (callCount === 2) {
								yield {
									type: "text-delta" as const,
									delta:
										", but they were not the welcoming party he had expected. Instead, he found them in a state of distress, with worried expressions on their faces.",
								};
								yield { type: "done" as const };
								return;
							}
							yield {
								type: "text-delta" as const,
								delta:
									' He approached them cautiously, his heart beginning to pound. "What happened?" he asked, scanning each of their faces for answers. For a moment, no one spoke, and the silence made the room feel even heavier. Then his mother stepped forward and told him everything that had changed while he was away.',
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{
			type: "insert-text",
			blockId,
			offset: 0,
			text: "He came home to",
		}]);
		editor.selectText(blockId, 16, 16);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				" find his family waiting for him.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text?.includes(
					"welcoming party",
				) === true,
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() => (inlineCompletion?.getState().visibleSuggestion?.previewBlocks?.length ?? 0) > 0,
		);

		expect(inlineCompletion?.getState().visibleSuggestion?.previewBlocks).toEqual([
			expect.objectContaining({
				text: expect.stringContaining(
					"For a moment, no one spoke, and the silence made the room feel even heavier.",
				),
				blockType: "paragraph",
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);

		const secondBlock = editor.getBlock(blockId)?.next;
		const thirdBlock = secondBlock?.next;
		expect(secondBlock?.type).toBe("paragraph");
		expect(secondBlock?.textContent()).toContain(
			"Instead, he found them in a state of distress, with worried expressions on their faces.",
		);
		expect(secondBlock?.textContent()).toContain(
			'He approached them cautiously, his heart beginning to pound. "What happened?" he asked, scanning each of their faces for answers.',
		);
		expect(thirdBlock?.type).toBe("paragraph");
		expect(thirdBlock?.textContent()).toContain(
			"For a moment, no one spoke, and the silence made the room feel even heavier.",
		);
		expect(thirdBlock?.textContent()).toContain(
			"Then his mother stepped forward and told him everything that had changed while he was away.",
		);

		editor.destroy();
	});

	it("promotes long depth-two prose continuations into a new paragraph earlier", async () => {
		let activeEditor: ReturnType<typeof createEditor> | null = null;
		let callCount = 0;
		const fieldEditor = {
			focusBlockId: null as string | null,
			isEditing: true,
			isFocused: true,
			isComposing: false,
		};
		const editor = createEditor({
			extensions: [
				autocompleteExtension({
					debounceMs: 0,
					prefetchAfterAccept: true,
					model: {
						async *stream() {
							callCount += 1;
							if (callCount === 1) {
								yield {
									type: "text-delta" as const,
									delta: '", tired from a long day at work."',
								};
								yield { type: "done" as const };
								return;
							}
							yield {
								type: "text-delta" as const,
								delta:
									'", but happy to be back. He looked forward to a quiet evening at home, away from the hustle and bustle of the office."',
							};
							yield { type: "done" as const };
						},
					},
				}),
				defineExtension({
					name: "test-field-editor-slot",
					activateClient: async ({ editor: nextEditor }) => {
						activeEditor = nextEditor;
						nextEditor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
					},
					deactivateClient: async () => {
						activeEditor?.internals.setSlot(FIELD_EDITOR_SLOT_KEY, null);
						activeEditor = null;
					},
				}),
			],
		});
		const blockId = editor.firstBlock()!.id;
		fieldEditor.focusBlockId = blockId;
		editor.apply([{
			type: "insert-text",
			blockId,
			offset: 0,
			text: "He came home ",
		}]);
		editor.selectText(blockId, 13, 13);

		const controller = getAutocompleteController(editor);
		const inlineCompletion = getInlineCompletionController(editor);
		expect(controller?.request({ explicit: true })).toBe(true);
		await waitForCondition(
			() =>
				inlineCompletion?.getState().visibleSuggestion?.text ===
				"tired from a long day at work.",
		);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);
		await waitForCondition(
			() => (inlineCompletion?.getState().visibleSuggestion?.previewBlocks?.length ?? 0) === 1,
		);

		expect(inlineCompletion?.getState().visibleSuggestion?.previewBlocks).toEqual([
			expect.objectContaining({
				blockType: "paragraph",
				text: expect.stringContaining(
					"He looked forward to a quiet evening at home, away from the hustle and bustle of the office.",
				),
			}),
		]);

		expect(controller?.acceptVisibleSuggestion()).toBe(true);

		const secondBlock = editor.getBlock(blockId)?.next;
		expect(secondBlock?.type).toBe("paragraph");
		expect(secondBlock?.textContent()).toContain(
			"He looked forward to a quiet evening at home, away from the hustle and bustle of the office.",
		);

		editor.destroy();
	});
});
