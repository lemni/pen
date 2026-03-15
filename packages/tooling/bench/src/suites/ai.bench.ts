import {
	createEditor,
	getInlineCompletionController,
} from "@pen/core";
import { FIELD_EDITOR_SLOT_KEY, defineExtension } from "@pen/types";
import { aiExtension } from "@pen/ai";
import {
	autocompleteExtension,
	createAutocompleteProvider,
	getAutocompleteController,
} from "@pen/ai-autocomplete";
import type { AutocompleteContextProvider } from "@pen/ai-autocomplete";
import { createTestEditor } from "@pen/test";
import type { ToolRuntime } from "@pen/types";
import { buildDocumentWriteOps } from "@pen/document-ops";
import {
	applyBenchMarkdownFastApply,
	parseBenchMarkdownFastApplyContract,
} from "../utils/markdownFastApply";
import {
	buildBenchFlowPatchAlignmentExecution,
	buildBenchFlowPatchScopedReplacementExecution,
	buildBenchFlowPatchTextEditExecution,
} from "../utils/flowPatchExecution";
import type { BenchDefinition } from "../bench";
import {
	AI_FLOW_PATCH_ALIGNMENT_BENCH,
	AI_FLOW_PATCH_SCOPED_REPLACEMENT_BENCH,
	AI_GET_CONTEXT_SUMMARY_200_BLOCKS_BENCH,
	AI_GET_CURSOR_CONTEXT_BENCH,
	AI_AUTOCOMPLETE_CANCEL_CHURN_BENCH,
	AI_AUTOCOMPLETE_PROVIDER_BUDGET_BENCH,
	AI_AUTOCOMPLETE_PARTIAL_ACCEPT_BENCH,
	AI_AUTOCOMPLETE_PREFETCH_AFTER_ACCEPT_BENCH,
	AI_AUTOCOMPLETE_REQUESTING_CANCEL_CHURN_BENCH,
	AI_MARKDOWN_FAST_APPLY_TABLE_INSERT_BENCH,
	AI_MARKDOWN_FULL_REPLACE_TABLE_INSERT_BENCH,
	AI_PROMPT_ASSEMBLY_TOOL_JOURNAL_BENCH,
	AI_READ_DOCUMENT_RANGE_20_BLOCKS_BENCH,
	AI_READ_DOCUMENT_SUMMARY_200_BLOCKS_BENCH,
	AI_RETRIEVE_DOCUMENT_SPANS_BENCH,
	AI_FLOW_PATCH_TEXT_EDIT_BENCH,
} from "../constants/benchmarks";

const AI_BENCH_BLOCK_COUNT = 200;
const AI_RANGE_START_BLOCK_ID = "block-90";
const AI_RANGE_END_BLOCK_ID = "block-109";

export const aiBenchmarks: BenchDefinition[] = [
	{
		...AI_READ_DOCUMENT_SUMMARY_200_BLOCKS_BENCH,
		async fn(b) {
			const editor = createAIBenchEditor();
			const toolRuntime = getToolRuntime(editor);

			b.start();
			await toolRuntime.executeTool("read_document", { format: "summary" }, {} as never);
			b.end();
		},
	},
	{
		...AI_GET_CONTEXT_SUMMARY_200_BLOCKS_BENCH,
		async fn(b) {
			const editor = createAIBenchEditor();
			const toolRuntime = getToolRuntime(editor);

			b.start();
			await toolRuntime.executeTool(
				"get_context",
				{ format: "summary", includeSelection: true },
				{} as never,
			);
			b.end();
		},
	},
	{
		...AI_GET_CURSOR_CONTEXT_BENCH,
		async fn(b) {
			const editor = createAIBenchEditor();
			const toolRuntime = getToolRuntime(editor);

			b.start();
			await toolRuntime.executeTool("get_cursor_context", {}, {} as never);
			b.end();
		},
	},
	{
		...AI_READ_DOCUMENT_RANGE_20_BLOCKS_BENCH,
		async fn(b) {
			const editor = createAIBenchEditor();
			const toolRuntime = getToolRuntime(editor);

			b.start();
			await toolRuntime.executeTool(
				"read_document",
				{
					format: "markdown",
					range: {
						startBlockId: AI_RANGE_START_BLOCK_ID,
						endBlockId: AI_RANGE_END_BLOCK_ID,
					},
				},
				{} as never,
			);
			b.end();
		},
	},
	{
		...AI_PROMPT_ASSEMBLY_TOOL_JOURNAL_BENCH,
		fn(b) {
			const toolResults = Array.from({ length: 8 }, (_, index) => ({
				toolCallId: `tool-${index}`,
				toolName: "read_document",
				input: {
					format: "summary",
					range: {
						startBlockId: `block-${index}`,
						endBlockId: `block-${index + 1}`,
					},
				},
				output: {
					blockCount: 2,
					blocks: Array.from({ length: 4 }, (__, blockIndex) => ({
						id: `block-${index}-${blockIndex}`,
						type: "paragraph",
						preview: "Benchmark output for prompt assembly.",
					})),
				},
			}));

			b.start();
			buildPromptAssemblyMessages({
				prompt: "Continue the current section.",
				workingSet: JSON.stringify({
					source: "cursor-context",
					surroundingBlocks: ["A", "B", "C"],
				}),
				toolResults,
			});
			b.end();
		},
	},
	{
		...AI_RETRIEVE_DOCUMENT_SPANS_BENCH,
		async fn(b) {
			const editor = createAIBenchEditor();
			const toolRuntime = getToolRuntime(editor);

			b.start();
			await toolRuntime.executeTool(
				"retrieve_document_spans",
				{
					query: "find the benchmark block about latency measurement near block 90",
					targetBlockId: AI_RANGE_START_BLOCK_ID,
					activeBlockId: AI_RANGE_START_BLOCK_ID,
				},
				{} as never,
			);
			b.end();
		},
	},
	{
		...AI_MARKDOWN_FAST_APPLY_TABLE_INSERT_BENCH,
		fn(b) {
			const contract = parseBenchMarkdownFastApplyContract(`
<pen-fast-apply>
  <instructions>I am inserting a people table after the intro paragraph.</instructions>
  <anchorBefore><![CDATA[Benchmark block 90. This is representative playground context for AI read latency measurement.]]></anchorBefore>
  <anchorAfter><![CDATA[Benchmark block 91. This is representative playground context for AI read latency measurement.]]></anchorAfter>
  <patch><![CDATA[
<!-- ... existing markdown ... -->

| Name | Role |
| --- | --- |
| Alice | Design |
| Bob | Engineering |
<!-- ... existing markdown ... -->
  ]]></patch>
</pen-fast-apply>
`);
			const originalMarkdown = [
				"Benchmark block 90. This is representative playground context for AI read latency measurement.",
				"",
				"Benchmark block 91. This is representative playground context for AI read latency measurement.",
			].join("\n");

			b.start();
			applyBenchMarkdownFastApply({
				originalMarkdown,
				contract: contract!,
			});
			b.end();
		},
	},
	{
		...AI_MARKDOWN_FULL_REPLACE_TABLE_INSERT_BENCH,
		fn(b) {
			const editor = createAIBenchEditor();
			const replacementMarkdown = [
				"Benchmark block 90. This is representative playground context for AI read latency measurement.",
				"",
				"| Name | Role |",
				"| --- | --- |",
				"| Alice | Design |",
				"| Bob | Engineering |",
				"",
				"Benchmark block 91. This is representative playground context for AI read latency measurement.",
			].join("\n");

			b.start();
			buildDocumentWriteOps(editor, {
				format: "markdown",
				content: replacementMarkdown,
				position: { before: AI_RANGE_START_BLOCK_ID },
				surface: "bench:ai-markdown-full-replace",
			});
			b.end();
		},
	},
	{
		...AI_FLOW_PATCH_TEXT_EDIT_BENCH,
		fn(b) {
			const editor = createAIBenchEditor();

			b.start();
			buildBenchFlowPatchTextEditExecution(
				editor,
				AI_RANGE_START_BLOCK_ID,
				"Benchmark block 90 updated for native patch compilation.",
			);
			b.end();
		},
	},
	{
		...AI_FLOW_PATCH_ALIGNMENT_BENCH,
		fn(b) {
			const editor = createAIBenchEditor();

			b.start();
			const result = buildBenchFlowPatchAlignmentExecution(editor);
			b.end();
			b.setMetrics({
				executionPath: "native-fast-apply",
				preservedBlockCount: result.metrics.preservedBlockCount,
				rewrittenBlockCount: result.metrics.rewrittenBlockCount,
				unchangedBlockCount: result.metrics.unchangedBlockCount,
				insertedBlockCount: result.metrics.insertedBlockCount,
				deletedBlockCount: result.metrics.deletedBlockCount,
				estimatedOperationCost: result.metrics.estimatedOperationCost,
				opCount: result.ops.length,
			});
		},
	},
	{
		...AI_FLOW_PATCH_SCOPED_REPLACEMENT_BENCH,
		fn(b) {
			const editor = createAIBenchEditor();

			b.start();
			const result = buildBenchFlowPatchScopedReplacementExecution(editor);
			b.end();
			b.setMetrics({
				executionPath: result.metrics.kind,
				opsCount: result.metrics.opsCount,
				insertedBlockCount: result.metrics.insertedBlockCount,
				deletedBlockCount: result.metrics.deletedBlockCount,
				targetBlockCount: result.metrics.targetBlockCount,
			});
		},
	},
	{
		...AI_AUTOCOMPLETE_CANCEL_CHURN_BENCH,
		fn(b) {
			const cycleCount = 25;
			const {
				controller,
				editor,
				getModelCallCount,
			} = createAutocompleteCancelChurnBenchEditor();

			b.start();
			for (let index = 0; index < cycleCount; index += 1) {
				controller.request();
				controller.updateBlockPolicy({ allowInCodeBlocks: false });
				controller.updateBlockPolicy({ allowInCodeBlocks: true });
			}
			b.end();

			const metrics = controller.getState().metrics;
			b.setMetrics({
				cycleCount,
				requestCount: metrics.requestCount,
				cancelCount: metrics.cancelCount,
				policyInvalidationScheduledCount:
					metrics.policyInvalidationScheduledCount,
				modelCallCount: getModelCallCount(),
			});
			editor.destroy();
		},
	},
	{
		...AI_AUTOCOMPLETE_REQUESTING_CANCEL_CHURN_BENCH,
		async fn(b) {
			const cycleCount = 10;
			const {
				controller,
				editor,
				getModelCallCount,
			} = createAutocompleteRequestingCancelChurnBenchEditor();

			b.start();
			for (let index = 0; index < cycleCount; index += 1) {
				controller.request({ explicit: true });
				await waitForCondition(
					() => controller.getState().status === "requesting",
				);
				controller.updateBlockPolicy({ allowInCodeBlocks: false });
				await waitForCondition(() => controller.getState().status === "idle");
				controller.updateBlockPolicy({ allowInCodeBlocks: true });
			}
			b.end();

			const metrics = controller.getState().metrics;
			b.setMetrics({
				cycleCount,
				requestCount: metrics.requestCount,
				cancelCount: metrics.cancelCount,
				policyInvalidationRequestingCount:
					metrics.policyInvalidationRequestingCount,
				modelCallCount: getModelCallCount(),
			});
			editor.destroy();
		},
	},
	{
		...AI_AUTOCOMPLETE_PROVIDER_BUDGET_BENCH,
		async fn(b) {
			const {
				controller,
				editor,
				getModelCallCount,
			} = createAutocompleteProviderBudgetBenchEditor();

			b.start();
			expectControllerRequest(controller.request({ explicit: true }));
			await waitForCondition(() => controller.hasVisibleSuggestion());
			b.end();

			const providerTimings = controller.getState().providerTimings;
			const totalProviderChars = providerTimings.reduce(
				(total, timing) => total + timing.chars,
				0,
			);
			b.setMetrics({
				includedProviderCount: providerTimings.length,
				totalProviderChars,
				slowProviderIncluded: providerTimings.some(
					(timing) => timing.id === "slow-timeout",
				),
				clippedProviderChars:
					providerTimings.find((timing) => timing.id === "consumer-clipped")
						?.chars ?? 0,
				modelCallCount: getModelCallCount(),
			});
			editor.destroy();
		},
	},
	{
		...AI_AUTOCOMPLETE_PARTIAL_ACCEPT_BENCH,
		async fn(b) {
			const {
				controller,
				editor,
				getModelCallCount,
			} = createAutocompletePartialAcceptBenchEditor();

			expectControllerRequest(controller.request({ explicit: true }));
			await waitForCondition(() => controller.hasVisibleSuggestion());

			const initialSegmentCount =
				controller.getState().sequence?.totalSegments ?? 0;
			let acceptStepCount = 0;

			b.start();
			while (controller.hasVisibleSuggestion()) {
				expectControllerRequest(controller.acceptVisibleSuggestion());
				acceptStepCount += 1;
			}
			b.end();

			const metrics = controller.getState().metrics;
			b.setMetrics({
				acceptStepCount,
				initialSegmentCount,
				acceptCount: metrics.acceptCount,
				partialAcceptCount: metrics.partialAcceptCount,
				modelCallCount: getModelCallCount(),
			});
			editor.destroy();
		},
	},
	{
		...AI_AUTOCOMPLETE_PREFETCH_AFTER_ACCEPT_BENCH,
		async fn(b) {
			const {
				controller,
				editor,
				getModelCallCount,
				getVisibleSuggestionText,
			} = createAutocompletePrefetchAfterAcceptBenchEditor();

			expectControllerRequest(controller.request({ explicit: true }));
			await waitForCondition(() => getVisibleSuggestionText() === " world from pen");

			b.start();
			expectControllerRequest(controller.acceptVisibleSuggestion());
			await waitForCondition(() => getModelCallCount() === 2);
			expectControllerRequest(controller.acceptVisibleSuggestion());
			await waitForCondition(() => getVisibleSuggestionText() === " again");
			b.end();

			const metrics = controller.getState().metrics;
			b.setMetrics({
				acceptCount: metrics.acceptCount,
				partialAcceptCount: metrics.partialAcceptCount,
				modelCallCount: getModelCallCount(),
				finalVisibleSuggestionLength: getVisibleSuggestionText().length,
			});
			editor.destroy();
		},
	},
];

function createAIBenchEditor() {
	const editor = createTestEditor({
		blocks: Array.from({ length: AI_BENCH_BLOCK_COUNT }, (_, index) => ({
			id: `block-${index}`,
			type: index % 8 === 0 ? "heading" : "paragraph",
			content:
				`Benchmark block ${index}. ` +
				"This is representative playground context for AI read latency measurement.",
		})),
	});
	const targetBlockId = AI_RANGE_START_BLOCK_ID;
	editor.selectTextRange(
		{ blockId: targetBlockId, offset: 0 },
		{ blockId: targetBlockId, offset: 18 },
	);
	return editor;
}

function getToolRuntime(editor: ReturnType<typeof createTestEditor>): ToolRuntime {
	const toolRuntime = editor.internals.getSlot<ToolRuntime>("document-ops:toolRuntime");
	if (!toolRuntime) {
		throw new Error("AI bench editor is missing the document-ops tool runtime.");
	}
	return toolRuntime;
}

function createAutocompleteCancelChurnBenchEditor() {
	let activeEditor: ReturnType<typeof createEditor> | null = null;
	let modelCallCount = 0;
	const fieldEditor = {
		focusBlockId: null as string | null,
		isEditing: true,
		isFocused: true,
		isComposing: false,
		activeCellCoord: null,
	};
	const editor = createEditor({
		extensions: [
			aiExtension(),
			autocompleteExtension({
				debounceMs: 10,
				model: {
					async *stream() {
						modelCallCount += 1;
						yield { type: "text-delta" as const, delta: " value" };
						yield { type: "done" as const };
					},
				},
			}),
			defineExtension({
				name: "bench-field-editor-slot",
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
	const codeBlockId = "bench-code-block";
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
	if (!controller) {
		throw new Error("Autocomplete bench editor is missing the autocomplete controller.");
	}
	return {
		editor,
		controller,
		getModelCallCount: () => modelCallCount,
	};
}

function createAutocompleteRequestingCancelChurnBenchEditor() {
	let modelCallCount = 0;
	const benchEditor = createAutocompleteBenchEditor({
		benchExtensionName: "bench-requesting-field-editor-slot",
		debounceMs: 0,
		blockId: "bench-requesting-code-block",
		blockType: "codeBlock",
		initialText: "const answer =",
		modelStream: async function* () {
			modelCallCount += 1;
			await new Promise((resolve) => setTimeout(resolve, 0));
			yield { type: "text-delta" as const, delta: " value" };
			yield { type: "done" as const };
		},
	});
	return {
		...benchEditor,
		getModelCallCount: () => modelCallCount,
	};
}

function createAutocompletePartialAcceptBenchEditor() {
	let modelCallCount = 0;
	const benchEditor = createAutocompleteBenchEditor({
		benchExtensionName: "bench-partial-accept-field-editor-slot",
		debounceMs: 0,
		blockId: "bench-partial-accept-block",
		initialText: "Hello",
		cursorOffset: 5,
		modelStream: async function* () {
			modelCallCount += 1;
			yield {
				type: "text-delta" as const,
				delta: " bright future together today",
			};
			yield { type: "done" as const };
		},
	});
	return {
		...benchEditor,
		getModelCallCount: () => modelCallCount,
	};
}

function createAutocompleteProviderBudgetBenchEditor() {
	let modelCallCount = 0;
	const benchEditor = createAutocompleteBenchEditor({
		benchExtensionName: "bench-provider-budget-field-editor-slot",
		debounceMs: 0,
		maxProviderChars: 48,
		maxProviderTimeMs: 5,
		blockId: "bench-provider-budget-block",
		initialText: "Hello",
		cursorOffset: 5,
		providers: [
			createAutocompleteProvider({
				id: "local-shape",
				priority: 300,
				provide() {
					return "shape: paragraph";
				},
			}),
			createAutocompleteProvider({
				id: "consumer-clipped",
				priority: 200,
				provide() {
					return "consumer context that should be clipped by the shared provider budget";
				},
			}),
			createAutocompleteProvider({
				id: "slow-timeout",
				priority: 150,
				async provide() {
					await new Promise((resolve) => setTimeout(resolve, 20));
					return "slow provider should not be included";
				},
			}),
		],
		modelStream: async function* () {
			modelCallCount += 1;
			yield { type: "text-delta" as const, delta: " world" };
			yield { type: "done" as const };
		},
	});
	return {
		...benchEditor,
		getModelCallCount: () => modelCallCount,
	};
}

function createAutocompletePrefetchAfterAcceptBenchEditor() {
	let modelCallCount = 0;
	const benchEditor = createAutocompleteBenchEditor({
		benchExtensionName: "bench-prefetch-field-editor-slot",
		debounceMs: 0,
		prefetchAfterAccept: true,
		blockId: "bench-prefetch-block",
		initialText: "Hello",
		cursorOffset: 5,
		modelStream: async function* () {
			modelCallCount += 1;
			if (modelCallCount === 1) {
				yield { type: "text-delta" as const, delta: " world from pen" };
				yield { type: "done" as const };
				return;
			}
			yield { type: "text-delta" as const, delta: "from pen again" };
			yield { type: "done" as const };
		},
	});
	const inlineCompletion = getInlineCompletionController(benchEditor.editor);
	if (!inlineCompletion) {
		throw new Error("Autocomplete bench editor is missing the inline completion controller.");
	}
	return {
		...benchEditor,
		getModelCallCount: () => modelCallCount,
		getVisibleSuggestionText: () =>
			inlineCompletion.getState().visibleSuggestion?.text ?? "",
	};
}

function createAutocompleteBenchEditor(input: {
	benchExtensionName: string;
	debounceMs: number;
	modelStream: () => AsyncGenerator<
		{ type: "text-delta"; delta: string } | { type: "done" },
		void,
		unknown
	>;
	prefetchAfterAccept?: boolean;
	maxProviderChars?: number;
	maxProviderTimeMs?: number;
	providers?: readonly AutocompleteContextProvider[];
	blockId: string;
	blockType?: string;
	initialText: string;
	cursorOffset?: number;
}) {
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
			aiExtension(),
			autocompleteExtension({
				debounceMs: input.debounceMs,
				prefetchAfterAccept: input.prefetchAfterAccept,
				maxProviderChars: input.maxProviderChars,
				maxProviderTimeMs: input.maxProviderTimeMs,
				providers: input.providers,
				model: {
					stream: input.modelStream,
				},
			}),
			defineExtension({
				name: input.benchExtensionName,
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
	if (input.blockType) {
		editor.apply([
			{
				type: "insert-block",
				blockId: input.blockId,
				blockType: input.blockType,
				props: {},
				position: { after: firstBlockId },
			},
			{
				type: "insert-text",
				blockId: input.blockId,
				offset: 0,
				text: input.initialText,
			},
		]);
	} else {
		editor.apply([
			{
				type: "insert-text",
				blockId: firstBlockId,
				offset: 0,
				text: input.initialText,
			},
		]);
	}

	const targetBlockId = input.blockType ? input.blockId : firstBlockId;
	const cursorOffset = input.cursorOffset ?? input.initialText.length;
	fieldEditor.focusBlockId = targetBlockId;
	editor.selectText(targetBlockId, cursorOffset, cursorOffset);

	const controller = getAutocompleteController(editor);
	if (!controller) {
		throw new Error("Autocomplete bench editor is missing the autocomplete controller.");
	}
	return {
		editor,
		controller,
	};
}

function expectControllerRequest(value: boolean): void {
	if (!value) {
		throw new Error("Autocomplete bench operation unexpectedly returned false.");
	}
}

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

function buildPromptAssemblyMessages(input: {
	prompt: string;
	workingSet: string;
	toolResults: Array<{
		toolCallId: string;
		toolName: string;
		input: unknown;
		output: unknown;
	}>;
}) {
	return [
		{
			role: "user",
			content: `${input.workingSet}\n\nUser request:\n${input.prompt}`,
		},
		...input.toolResults.flatMap((toolResult) => [
			{
				role: "assistant",
				content: [{
					type: "tool-call",
					toolCallId: toolResult.toolCallId,
					toolName: toolResult.toolName,
					input: toolResult.input,
				}],
			},
			{
				role: "tool",
				content: [{
					type: "tool-result",
					toolCallId: toolResult.toolCallId,
					result: toolResult.output,
				}],
			},
		]),
	];
}

