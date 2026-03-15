import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "@pen/types";
import {
	AI_TOOL_RUNTIME_SLOT,
	AIToolContextImpl,
	AIToolRuntimeImpl,
	collectAIToolOutput,
	executeAITool,
	getAIToolRuntime,
	listAITools,
} from "../index";

describe("@pen/ai-tools", () => {
	it("reads the canonical tool runtime slot from the editor", () => {
		const runtime = new AIToolRuntimeImpl();
		const editor = {
			internals: {
				getSlot<T>(key: string): T | undefined {
					return key === AI_TOOL_RUNTIME_SLOT ? (runtime as T) : undefined;
				},
			},
		} as never;

		expect(getAIToolRuntime(editor)).toBe(runtime);
	});

	it("lists tool descriptors", () => {
		const runtime = new AIToolRuntimeImpl();
		runtime.registerTool({
			name: "echo",
			description: "Echo input",
			inputSchema: { type: "object", properties: {} },
			handler: async (input) => input,
		});

		expect(listAITools(runtime)).toEqual([
			{
				name: "echo",
				description: "Echo input",
				inputSchema: { type: "object", properties: {} },
			},
		]);
	});

	it("buffers async iterable tool output", async () => {
		const output = await collectAIToolOutput(
			(async function* () {
				yield { part: 1 };
				yield { part: 2 };
			})(),
		);

		expect(output).toEqual([{ part: 1 }, { part: 2 }]);
	});

	it("executes tools with a shared context helper", async () => {
		const runtime = new AIToolRuntimeImpl();
		const editor = {
			apply() {
				/* noop */
			},
			internals: {
				getSlot() {
					return undefined;
				},
			},
		} as never;

		const tool: ToolDefinition = {
			name: "insert_summary",
			description: "Insert a paragraph",
			inputSchema: {
				type: "object",
				properties: {
					content: { type: "string" },
				},
				required: ["content"],
			},
			handler: async (input, context) => {
				context.beginStreaming("zone-1", "block-1");
				context.appendDelta((input as { content: string }).content);
				context.endStreaming("complete");
				return { ok: true };
			},
		};
		runtime.registerTool(tool);

		const emitted: unknown[] = [];
		const context = new AIToolContextImpl(editor, "doc-1", (part) => {
			emitted.push(part);
		});
		const result = await executeAITool(
			runtime,
			"insert_summary",
			{ content: "Hello" },
			context,
		);

		expect(result).toEqual({ ok: true });
		expect(emitted).toEqual([
			{
				type: "gen-start",
				zoneId: "zone-1",
				blockId: "block-1",
			},
			{
				type: "gen-delta",
				zoneId: "zone-1",
				delta: "Hello",
			},
			{
				type: "gen-end",
				zoneId: "zone-1",
				status: "complete",
			},
		]);
	});
});
