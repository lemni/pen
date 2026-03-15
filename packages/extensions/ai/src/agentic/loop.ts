import type {
	ModelAdapter,
	StreamingTarget
} from "@pen/types";
import { collectToolExecutionOutput } from "@pen/types";
import {
	buildAgentMessages,
	buildAssistantToolCallParts,
	type ToolJournalEntry,
} from "../runtime/stepJournal";
import type { AgenticLoopOptions, AgenticStep, GenerationState } from "../types";
import { publishAwareness } from "./awareness";
import { buildToolContext } from "./contextBuilder";

export async function runAgenticLoop(
	options: AgenticLoopOptions,
): Promise<GenerationState> {
	const {
		model,
		editor,
		toolRuntime,
		prompt,
		blockId,
		generationId = crypto.randomUUID(),
		zoneId = crypto.randomUUID(),
		maxSteps = 10,
		signal,
		workingSet,
		validateWorkingSet,
		refreshWorkingSet,
		onStatusChange,
		onStep,
		onTextDelta,
		onCompleteText,
		onToolCall,
		onToolOutput,
		onToolResult,
		onStructuredData,
		onMessagesChange,
		onStreamingStart,
		onStreamingEnd,
		onDebug,
	} = options;

	const steps: AgenticStep[] = [];
	const consecutiveErrors = new Map<string, number>();
	const toolJournal: ToolJournalEntry[] = [];
	let textBuffer = "";
	let stepIndex = 0;
	let streamingStarted = false;
	let messageAssemblyLatencyMs = 0;
	let firstToolStartMs: number | null = null;
	let firstToolResultMs: number | null = null;
	let firstVisibleTextMs: number | null = null;
	let toolExecutionMs = 0;
	const loopStartedAt = performance.now();
	let staleContextCount = 0;
	let workingSetRefreshCount = 0;
	let routeConfidence = workingSet?.routeConfidence;
	let currentWorkingSet = workingSet ?? null;

	const toolSchemas = toolRuntime.listTools().map((tool) => ({
		name: tool.name,
		description: tool.description,
		inputSchema: tool.inputSchema,
	}));
	const streamingTarget =
		editor.internals.getSlot<StreamingTarget>("delta-stream:target") ?? null;
	const toolContext = buildToolContext(
		editor,
		zoneId,
		blockId,
		streamingTarget,
	);

	editor.undoManager.stopCapturing();
	onStatusChange?.("thinking");
	publishAwareness(editor, {
		status: "thinking",
		activeBlockId: blockId,
		model: getModelName(model),
		generationZoneId: zoneId,
	});

	while (stepIndex < maxSteps) {
		if (signal?.aborted) break;

		const validation = validateWorkingSet?.(currentWorkingSet) ?? {
			valid: true,
			canRefresh: false,
		};
		if (!validation.valid) {
			staleContextCount += 1;
			if (validation.canRefresh && refreshWorkingSet) {
				currentWorkingSet = await refreshWorkingSet();
				workingSetRefreshCount += 1;
				routeConfidence = currentWorkingSet?.routeConfidence ?? routeConfidence;
			} else {
				throw new StaleWorkingSetError(validation.reason ?? "working-set-invalid");
			}
		}

		const assemblyStart = performance.now();
		const messages = buildAgentMessages({
			prompt,
			workingSet: currentWorkingSet ? buildWorkingSetPrompt(currentWorkingSet) : null,
			toolResults: toolJournal,
		});
		messageAssemblyLatencyMs += performance.now() - assemblyStart;

		const availableTools = toolSchemas.filter((tool) => {
			const failures = consecutiveErrors.get(tool.name) ?? 0;
			return failures < 3;
		});
		const stream = model.stream({ messages, tools: availableTools, signal });
		const pendingToolCalls: Array<{
			toolCallId: string;
			toolName: string;
			input: unknown;
		}> = [];
		let emittedTextInPass = false;
		let passTextBuffer = "";

		for await (const event of stream) {
			if (signal?.aborted) break;

			if (event.type === "text-delta") {
				if (!emittedTextInPass && pendingToolCalls.length === 0) {
					onStatusChange?.("writing");
					publishAwareness(editor, {
						status: "writing",
						activeBlockId: blockId,
						model: getModelName(model),
						generationZoneId: zoneId,
					});
					if (!streamingStarted) {
						onStreamingStart?.(zoneId, blockId);
						streamingStarted = true;
					}
				}
				if (firstVisibleTextMs == null) {
					firstVisibleTextMs = performance.now() - loopStartedAt;
				}
				emittedTextInPass = true;
				textBuffer += event.delta;
				passTextBuffer += event.delta;
				onTextDelta?.(event.delta);
				continue;
			}

			if (event.type === "structured-data") {
				if (firstVisibleTextMs == null) {
					firstVisibleTextMs = performance.now() - loopStartedAt;
				}
				onStructuredData?.({
					data: event.data,
					final: event.final === true,
				});
				continue;
			}

			if (event.type === "tool-call") {
				pendingToolCalls.push({
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					input: event.input,
				});
				onToolCall?.({
					toolCallId: event.toolCallId,
					toolName: event.toolName,
					input: event.input,
				});
				continue;
			}

			if (event.type === "error") {
				if (streamingStarted) {
					onStreamingEnd?.("error");
				}
				publishAwareness(editor, null);
				throw event.error;
			}

			if (event.type === "done") {
				break;
			}
		}

		if (pendingToolCalls.length === 0) {
			if (passTextBuffer.length > 0) {
				onMessagesChange?.([
					...messages,
					{
						role: "assistant",
						content: passTextBuffer,
					},
				]);
			}
			break;
		}

		onMessagesChange?.([
			...messages,
			{
				role: "assistant",
				content: buildAssistantToolCallParts(
					pendingToolCalls.map((toolCall) => ({
						toolCallId: toolCall.toolCallId,
						toolName: toolCall.toolName,
						input: toolCall.input,
						output: null,
					})),
					passTextBuffer,
				),
			},
		]);

		for (const toolCall of pendingToolCalls) {
			const step: AgenticStep = {
				index: stepIndex++,
				type: "tool-call",
				toolName: toolCall.toolName,
				toolCallId: toolCall.toolCallId,
				input: toolCall.input,
				status: "running",
			};
			steps.push(step);
			onStep?.(step);

			onStatusChange?.("tool-calling");
			publishAwareness(editor, {
				status: "tool-calling",
				activeBlockId: blockId,
				model: getModelName(model),
				activeTool: {
					name: toolCall.toolName,
					toolCallId: toolCall.toolCallId,
				},
				generationZoneId: zoneId,
			});

			try {
				if (firstToolStartMs == null) {
					firstToolStartMs = performance.now() - loopStartedAt;
				}
				const toolStartedAt = performance.now();
				const result = toolRuntime.executeTool(
					toolCall.toolName,
					toolCall.input,
					toolContext,
				);
				const output = await collectToolExecutionOutput(result, (part, progressiveOutput) => {
					step.output = progressiveOutput;
					onStep?.({ ...step });
					onToolOutput?.({
						toolCallId: toolCall.toolCallId,
						toolName: toolCall.toolName,
						part,
						output: progressiveOutput,
					});
				});
				toolExecutionMs += performance.now() - toolStartedAt;
				step.output = output;
				step.status = "complete";
				consecutiveErrors.set(toolCall.toolName, 0);
				if (firstToolResultMs == null) {
					firstToolResultMs = performance.now() - loopStartedAt;
				}

				const resultStep: AgenticStep = {
					index: stepIndex++,
					type: "tool-result",
					toolName: toolCall.toolName,
					toolCallId: toolCall.toolCallId,
					output,
					status: "complete",
				};
				steps.push(resultStep);
				onStep?.(resultStep);
				onToolResult?.({
					toolCallId: toolCall.toolCallId,
					toolName: toolCall.toolName,
					output,
					state: "complete",
				});

				toolJournal.push({
					toolCallId: toolCall.toolCallId,
					toolName: toolCall.toolName,
					input: toolCall.input,
					output,
				});
				onMessagesChange?.(
					buildAgentMessages({
						prompt,
						workingSet: currentWorkingSet ? buildWorkingSetPrompt(currentWorkingSet) : null,
						toolResults: toolJournal,
					}),
				);
			} catch (error) {
				toolExecutionMs += 0;
				const failures = (consecutiveErrors.get(toolCall.toolName) ?? 0) + 1;
				consecutiveErrors.set(toolCall.toolName, failures);
				step.status = "error";
				step.output = error instanceof Error ? error.message : String(error);
				onToolResult?.({
					toolCallId: toolCall.toolCallId,
					toolName: toolCall.toolName,
					output: step.output,
					state: "error",
				});
				toolJournal.push({
					toolCallId: toolCall.toolCallId,
					toolName: toolCall.toolName,
					input: toolCall.input,
					output: step.output,
					isError: true,
				});
				onMessagesChange?.(
					buildAgentMessages({
						prompt,
						workingSet: currentWorkingSet ? buildWorkingSetPrompt(currentWorkingSet) : null,
						toolResults: toolJournal,
					}),
				);
			}
		}
	}

	onCompleteText?.(textBuffer);
	onStatusChange?.("idle");
	publishAwareness(editor, null);
	if (streamingStarted) {
		onStreamingEnd?.(signal?.aborted ? "cancelled" : "complete");
	}

	onDebug?.({
		messageAssemblyLatencyMs,
		firstToolStartMs,
		firstToolResultMs,
		firstVisibleTextMs,
		toolExecutionMs,
		qualitySignals: {
			staleContextRate: staleContextCount,
			requestRestartRateUnderChurn: workingSetRefreshCount,
		},
		routeConfidence,
	});

	return {
		id: generationId,
		zoneId,
		blockId,
		target: "block",
		prompt,
		status: signal?.aborted ? "cancelled" : "complete",
		tokenCount: 0,
		steps,
		undoGroupId: generationId,
		text: textBuffer,
		debug: {
			messageAssemblyLatencyMs,
			firstToolStartMs,
			firstToolResultMs,
			firstVisibleTextMs,
			toolExecutionMs,
			qualitySignals: {
				staleContextRate: staleContextCount,
				requestRestartRateUnderChurn: workingSetRefreshCount,
			},
			routeConfidence,
		},
	};
}

function buildWorkingSetPrompt(
	workingSet: NonNullable<AgenticLoopOptions["workingSet"]>,
): string {
	return [
		`Working set source: ${workingSet.source}`,
		`Document version: ${workingSet.documentVersion}`,
		`View mode: ${workingSet.viewMode}`,
		"Document context:",
		typeof workingSet.context === "string"
			? workingSet.context
			: JSON.stringify(workingSet.context),
	].join("\n");
}

class StaleWorkingSetError extends Error {
	constructor(reason: string) {
		super(reason);
		this.name = "StaleWorkingSetError";
	}
}

function getModelName(model: ModelAdapter & { name?: string; modelId?: string }): string {
	return model.name ?? model.modelId ?? "unknown";
}
