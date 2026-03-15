import { describe, expect, it } from "vitest";
import { createEditor } from "@pen/core";
import { buildPlaygroundRequestPlan } from "../runtime/playgroundPlanner";
import { buildStructuredIntentRequestPrompt } from "../runtime/structuredIntent";

const TEST_PLANNER_CONFIG = {
	documentModel: "test-document-model",
	selectionModel: "test-selection-model",
	documentSystemPrompt: "Document system prompt",
	structuredPlannerSystemPrompt: "Structured planner system prompt",
	selectionFastPathSystemPrompt: "Selection system prompt",
	autocompleteSystemPrompt: "Autocomplete system prompt",
	selectionSourceCharLimit: 12_000,
	selectionStopSentinel: "<pen:end>",
	selectionOutputTokenCap: 1_200,
	autocompleteOutputTokenCap: 48,
	selectionDefaultOutputTokens: 128,
	selectionExpandOutputTokens: 640,
	selectionSummarizeOutputTokens: 160,
	selectionTranslateOutputTokens: 480,
} as const;

describe("playground planner", () => {
	it("builds document-agent prompts that avoid assistant-style lead-ins", () => {
		const editor = createEditor();
		const plan = buildPlaygroundRequestPlan(
			editor,
			"Write a short story about the sea",
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("document-agent");
		expect(plan.prompt).toContain(
			"When you answer with document content, return only the content to insert or apply.",
		);
		expect(plan.prompt).toContain(
			'Do not add conversational lead-ins like "Here is", "Here\'s", or "I wrote".',
		);
	});

	it("preserves structured planner prompts as raw JSON-planning requests", () => {
		const editor = createEditor();
		const prompt = [
			"Produce a structured Pen document mutation plan.",
			"Return exactly one JSON object and no markdown fences or prose.",
			'User request:',
			"Create a table with names",
		].join("\n");
		const plan = buildPlaygroundRequestPlan(
			editor,
			prompt,
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("structured-planner");
		expect(plan.systemPrompt).toBe("Structured planner system prompt");
		expect(plan.prompt).toBe(prompt);
		expect(plan.contextFormat).toBe("none");
		expect(plan.useTools).toBe(false);
		expect(plan.promptContext).toBeNull();
	});

	it("detects structured planner prompts when wrapped in working-set context", () => {
		const editor = createEditor();
		const wrappedPrompt = [
			"Working set:",
			'{"activeBlockType":"paragraph"}',
			"",
			"User request:",
			"Produce a structured Pen document mutation plan.",
			"Return exactly one JSON object and no markdown fences or prose.",
			'User request:',
			"Create a table with names",
		].join("\n");
		const plan = buildPlaygroundRequestPlan(
			editor,
			wrappedPrompt,
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("structured-planner");
		expect(plan.prompt).toBe(wrappedPrompt);
		expect(plan.useTools).toBe(false);
	});

	it("treats structured intent envelopes as the shared structured route contract", () => {
		const editor = createEditor();
		const prompt = buildStructuredIntentRequestPrompt({
			prompt: "Create a database with names",
			targetKind: "database",
			activeBlockId: "anchor-block",
			workingSet: null,
		});
		const plan = buildPlaygroundRequestPlan(
			editor,
			prompt,
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("structured-planner");
		expect(plan.prompt).toBe(prompt);
		expect(plan.useTools).toBe(false);
		expect(plan.contextFormat).toBe("none");
	});

	it("routes inline autocomplete prompts through the fast no-tools path", () => {
		const editor = createEditor();
		const prompt = [
			'prefix="Hey there,"',
			"cursor_here=true",
			'suffix=""',
			"[provider:block-shape]",
			"block_type=paragraph",
		].join("\n");
		const plan = buildPlaygroundRequestPlan(
			editor,
			prompt,
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("inline-autocomplete");
		expect(plan.modelId).toBe("test-selection-model");
		expect(plan.systemPrompt).toBe("Autocomplete system prompt");
		expect(plan.prompt).toBe(prompt);
		expect(plan.contextFormat).toBe("none");
		expect(plan.useTools).toBe(false);
		expect(plan.maxOutputTokens).toBe(48);
		expect(plan.promptContext).toBeNull();
	});

	it("routes selection prompts through the fast path when live selection is present", () => {
		const editor = createEditor();
		const blockId = editor.firstBlock()!.id;
		editor.apply([{
			type: "insert-text",
			blockId,
			offset: 0,
			text: "Hello there",
		}]);
		editor.selectText(blockId, 0, 5);

		const plan = buildPlaygroundRequestPlan(
			editor,
			"Rewrite to be friendlier\n\nHello",
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("selection-fast");
		expect(plan.modelId).toBe("test-selection-model");
		expect(plan.useTools).toBe(false);
		expect(plan.selectedTextLength).toBe(5);
		expect(plan.prompt).toContain("Instruction:\nRewrite to be friendlier");
		expect(plan.prompt).toContain("Selected text:\nHello");
	});

	it("keeps selection prompts on the fast path when the prompt is pinned to a selection", () => {
		const editor = createEditor();
		const prompt = [
			"You are writing Pen flow content as markdown.",
			"Return only markdown content. Do not add commentary, JSON, or conversational lead-ins.",
			"",
			"Context summary:",
			"Source: selection",
			"Selected text:",
			"Hello there",
			"",
			"User request:",
			"Rewrite to be friendlier",
		].join("\n");

		const plan = buildPlaygroundRequestPlan(
			editor,
			prompt,
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("selection-fast");
		expect(plan.modelId).toBe("test-selection-model");
		expect(plan.useTools).toBe(false);
		expect(plan.selectedTextLength).toBe("Hello there".length);
		expect(plan.prompt).toContain("Instruction:\nRewrite to be friendlier");
		expect(plan.prompt).toContain("Selected text:\nHello there");
	});

	it("does not treat non-selection context summaries as selection fast-path prompts", () => {
		const editor = createEditor();
		const prompt = [
			"You are writing Pen flow content as markdown.",
			"",
			"Context summary:",
			"Source: cursor-context",
			"Selected text:",
			"Hello there",
			"",
			"User request:",
			"Rewrite to be friendlier",
		].join("\n");

		const plan = buildPlaygroundRequestPlan(
			editor,
			prompt,
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("document-agent");
	});

	it("increases autocomplete output tokens for paragraph continuations", () => {
		const editor = createEditor();
		const prompt = [
			'prefix="Hey there, how are you?"',
			"cursor_here=true",
			'suffix=""',
			"[continuation]",
			"depth=1",
			"target_scope=finish-paragraph",
			"[provider:block-shape]",
			"block_type=paragraph",
		].join("\n");
		const plan = buildPlaygroundRequestPlan(
			editor,
			prompt,
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("inline-autocomplete");
		expect(plan.maxOutputTokens).toBe(256);
	});

	it("increases autocomplete output tokens further for cross-paragraph continuations", () => {
		const editor = createEditor();
		const prompt = [
			'prefix="Hey there, how are you?"',
			"cursor_here=true",
			'suffix=""',
			"[continuation]",
			"depth=2",
			"target_scope=continue-across-paragraphs",
			"[provider:block-shape]",
			"block_type=paragraph",
		].join("\n");
		const plan = buildPlaygroundRequestPlan(
			editor,
			prompt,
			TEST_PLANNER_CONFIG,
		);

		expect(plan.mode).toBe("inline-autocomplete");
		expect(plan.maxOutputTokens).toBe(640);
	});
});
