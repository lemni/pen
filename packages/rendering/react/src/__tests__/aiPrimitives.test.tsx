// @vitest-environment jsdom

import React, { act } from "react";
import { describe, expect, it } from "vitest";
import { createRoot } from "react-dom/client";
import { createEditor } from "@pen/core";
import { defineExtension, type ToolRuntime } from "@pen/types";
import { aiExtension, getAIController } from "@pen/ai";
import { defaultPreset } from "@pen/preset-default";
import {
	Pen,
	useAIActions,
	useAISessions,
	useActiveAISession,
	useAIDebugLog,
} from "../index";

(
	globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function createKeyDownEvent(
	key: string,
	options: KeyboardEventInit = {},
): KeyboardEvent {
	return new KeyboardEvent("keydown", {
		key,
		bubbles: true,
		cancelable: true,
		...options,
	});
}

function createDeferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((nextResolve) => {
		resolve = nextResolve;
	});
	return { promise, resolve };
}

function mockSelectionToolbarRect(rect: {
	top: number;
	left: number;
	width: number;
	height: number;
}) {
	const originalGetSelection = window.getSelection.bind(window);
	const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
	const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
	const rangeRect = {
		top: rect.top,
		left: rect.left,
		width: rect.width,
		height: rect.height,
		right: rect.left + rect.width,
		bottom: rect.top + rect.height,
		x: rect.left,
		y: rect.top,
		toJSON() {
			return this;
		},
	} as DOMRect;

	Object.defineProperty(window, "getSelection", {
		configurable: true,
		value: () => ({
			rangeCount: 1,
			getRangeAt: () => ({
				getBoundingClientRect: () => rangeRect,
			}),
		}),
	});
	Object.defineProperty(window, "requestAnimationFrame", {
		configurable: true,
		value: (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		},
	});
	Object.defineProperty(window, "cancelAnimationFrame", {
		configurable: true,
		value: () => { },
	});

	return () => {
		Object.defineProperty(window, "getSelection", {
			configurable: true,
			value: originalGetSelection,
		});
		Object.defineProperty(window, "requestAnimationFrame", {
			configurable: true,
			value: originalRequestAnimationFrame,
		});
		Object.defineProperty(window, "cancelAnimationFrame", {
			configurable: true,
			value: originalCancelAnimationFrame,
		});
	};
}

function mockMutableSelectionToolbarRect(initialRect: {
	top: number;
	left: number;
	width: number;
	height: number;
}) {
	const rect = { ...initialRect };
	const originalGetSelection = window.getSelection.bind(window);
	const originalRequestAnimationFrame = window.requestAnimationFrame.bind(window);
	const originalCancelAnimationFrame = window.cancelAnimationFrame.bind(window);

	Object.defineProperty(window, "getSelection", {
		configurable: true,
		value: () => ({
			rangeCount: 1,
			getRangeAt: () => ({
				getBoundingClientRect: () =>
					({
						top: rect.top,
						left: rect.left,
						width: rect.width,
						height: rect.height,
						right: rect.left + rect.width,
						bottom: rect.top + rect.height,
						x: rect.left,
						y: rect.top,
						toJSON() {
							return this;
						},
					}) as DOMRect,
			}),
		}),
	});
	Object.defineProperty(window, "requestAnimationFrame", {
		configurable: true,
		value: (callback: FrameRequestCallback) => {
			callback(0);
			return 1;
		},
	});
	Object.defineProperty(window, "cancelAnimationFrame", {
		configurable: true,
		value: () => { },
	});

	return {
		rect,
		restore: () => {
			Object.defineProperty(window, "getSelection", {
				configurable: true,
				value: originalGetSelection,
			});
			Object.defineProperty(window, "requestAnimationFrame", {
				configurable: true,
				value: originalRequestAnimationFrame,
			});
			Object.defineProperty(window, "cancelAnimationFrame", {
				configurable: true,
				value: originalCancelAnimationFrame,
			});
		},
	};
}

async function waitForAttributeValue(
	readValue: () => string | null | undefined,
	expectedValue: string,
	maxTicks = 12,
): Promise<void> {
	for (let tick = 0; tick < maxTicks; tick += 1) {
		if (readValue() === expectedValue) {
			return;
		}
		await Promise.resolve();
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
}

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
				async *handler(input: unknown) {
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

describe("@pen/react AI primitives", () => {
	it("renders bottom-chat markdown as schema blocks while streaming", async () => {
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
							yield { type: "text-delta" as const, delta: "# Story\n\nOnce upon " };
							await releaseFinalDelta.promise;
							yield { type: "text-delta" as const, delta: "a time" };
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.Editor.Content />
				</Pen.Editor.Root>,
			);
		});

		let session:
			| ReturnType<NonNullable<typeof controller>["startSession"]>
			| null = null;
		let generationPromise: Promise<unknown> | null = null;

		await act(async () => {
			session = controller!.startSession({
				surface: "bottom-chat",
				target: "document",
			});
			generationPromise = controller!.runSessionPrompt(
				session!.id,
				"Write a short story",
				{ target: "document" },
			);
			await waitForCondition(() => {
				const heading = container.querySelector("h1[data-block-type='heading']");
				const text = (container.textContent ?? "").replace(/\u200B/g, "");
				return heading?.textContent?.includes("Story") === true && text.includes("Once upon");
			});
		});

		const heading = container.querySelector("h1[data-block-type='heading']");
		expect(heading?.textContent).toContain("Story");
		expect((container.textContent ?? "").replace(/\u200B/g, "")).toContain("Once upon");

		await act(async () => {
			releaseFinalDelta.resolve();
			await generationPromise;
		});

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("exposes AI sessions through React hooks", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		function SessionProbe() {
			const sessions = useAISessions(editor);
			const activeSession = useActiveAISession(editor);
			const actions = useAIActions(editor);

			return (
				<div
					data-session-count={String(sessions.length)}
					data-active-session-id={activeSession?.id ?? undefined}
					data-session-action-ready={
						typeof actions.startSession === "function" ? "" : undefined
					}
				/>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<SessionProbe />
				</Pen.Editor.Root>,
			);
		});

		let sessionId = "";
		await act(async () => {
			const session = controller?.startSession({
				surface: "inline-edit",
				target: "selection",
			});
			if (session) {
				sessionId = session.id;
				await controller?.runSessionPrompt(session.id, "Rewrite the selection");
			}
		});

		await act(async () => {
			const controllerAny = controller as any;
			controllerAny?._recordSessionFastApplyMetrics(sessionId, {
				attempted: true,
				succeeded: true,
				executionPath: "native-fast-apply",
			});
			await Promise.resolve();
		});

		const probe = container.querySelector("[data-session-count]");
		expect(probe?.getAttribute("data-session-count")).toBe("1");
		expect(probe?.getAttribute("data-active-session-id")).toBeTruthy();
		expect(probe?.getAttribute("data-session-action-ready")).toBe("");

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("exposes AI debug logs through a React hook", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		function DebugProbe() {
			const debugLog = useAIDebugLog(editor);

			return (
				<div
					data-status={debugLog.status}
					data-entry-count={String(debugLog.entries.length)}
					data-active-generation-id={debugLog.activeGenerationId ?? undefined}
					data-aggregate-fast-apply-attempt-count={String(
						debugLog.aggregateFastApply.attemptCount,
					)}
					data-aggregate-fast-apply-native-count={String(
						debugLog.aggregateFastApply.nativeFastApplyCount,
					)}
					data-fast-apply-attempt-count={
						debugLog.activeSessionFastApply
							? String(debugLog.activeSessionFastApply.attemptCount)
							: undefined
					}
					data-fast-apply-native-count={
						debugLog.activeSessionFastApply
							? String(debugLog.activeSessionFastApply.nativeFastApplyCount)
							: undefined
					}
					data-fast-apply-scoped-count={
						debugLog.activeSessionFastApply
							? String(debugLog.activeSessionFastApply.scopedReplacementCount)
							: undefined
					}
					data-fast-apply-plain-count={
						debugLog.activeSessionFastApply
							? String(debugLog.activeSessionFastApply.plainMarkdownCount)
							: undefined
					}
					data-fast-apply-failed-count={
						debugLog.activeSessionFastApply
							? String(debugLog.activeSessionFastApply.failedCount)
							: undefined
					}
					data-last-entry-label={
						debugLog.entries[debugLog.entries.length - 1]?.label ?? undefined
					}
				/>
			);
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<DebugProbe />
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			const session = controller?.startSession({
				surface: "inline-edit",
				target: "selection",
			});
			if (session) {
				await controller?.runSessionPrompt(session.id, "Rewrite the selection");
			}
		});

		const probe = container.querySelector("[data-entry-count]");
		expect(Number(probe?.getAttribute("data-entry-count"))).toBeGreaterThan(0);
		expect(probe?.getAttribute("data-active-generation-id")).toBeTruthy();
		expect(probe?.getAttribute("data-aggregate-fast-apply-attempt-count")).toBe("1");
		expect(probe?.getAttribute("data-aggregate-fast-apply-native-count")).toBe("1");
		expect(probe?.getAttribute("data-fast-apply-attempt-count")).toBe("1");
		expect(probe?.getAttribute("data-fast-apply-native-count")).toBe("1");
		expect(probe?.getAttribute("data-fast-apply-scoped-count")).toBe("0");
		expect(probe?.getAttribute("data-fast-apply-plain-count")).toBe("0");
		expect(probe?.getAttribute("data-fast-apply-failed-count")).toBe("0");
		expect(probe?.getAttribute("data-last-entry-label")).toBe("Generation finished");

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("reads fast-apply metrics for a requested session in the debug hook", async () => {
		const editor = createEditor({
			extensions: [aiExtension({})],
		});
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		function DebugProbe(props: { sessionId: string }) {
			const debugLog = useAIDebugLog(editor, { sessionId: props.sessionId });

			return (
				<div
					data-fast-apply-session-id={debugLog.fastApplySessionId ?? undefined}
					data-aggregate-fast-apply-attempt-count={String(
						debugLog.aggregateFastApply.attemptCount,
					)}
					data-aggregate-fast-apply-native-count={String(
						debugLog.aggregateFastApply.nativeFastApplyCount,
					)}
					data-fast-apply-attempt-count={
						debugLog.activeSessionFastApply
							? String(debugLog.activeSessionFastApply.attemptCount)
							: undefined
					}
					data-fast-apply-native-count={
						debugLog.activeSessionFastApply
							? String(debugLog.activeSessionFastApply.nativeFastApplyCount)
							: undefined
					}
				/>
			);
		}

		const bottomChatSession = controller!.startSession({
			surface: "bottom-chat",
			target: "document",
		});
		const inlineSession = controller!.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		expect(controller!.getState().activeSessionId).toBe(inlineSession.id);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			const controllerAny = controller as any;
			controllerAny?._recordSessionFastApplyMetrics(bottomChatSession.id, {
				attempted: true,
				succeeded: true,
				executionPath: "native-fast-apply",
			});
			controllerAny?._recordSessionFastApplyMetrics(bottomChatSession.id, {
				attempted: true,
				succeeded: true,
				executionPath: "scoped-replacement",
			});
			root.render(
				<Pen.Editor.Root editor={editor}>
					<DebugProbe sessionId={bottomChatSession.id} />
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		const probe = container.querySelector(
			"[data-fast-apply-session-id]",
		) as HTMLElement | null;
		expect(probe?.getAttribute("data-fast-apply-session-id")).toBe(
			bottomChatSession.id,
		);
		expect(probe?.getAttribute("data-aggregate-fast-apply-attempt-count")).toBe("2");
		expect(probe?.getAttribute("data-aggregate-fast-apply-native-count")).toBe("1");
		expect(probe?.getAttribute("data-fast-apply-attempt-count")).toBe("2");
		expect(probe?.getAttribute("data-fast-apply-native-count")).toBe("1");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
	});

	it("renders an inline AI session from the selection toolbar", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 160,
			width: 120,
			height: 18,
		});
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const trigger = container.querySelector(
			"[data-pen-ai-selection-trigger]",
		) as HTMLButtonElement | null;
		expect(trigger).toBeTruthy();
		expect(trigger?.disabled).toBe(false);
		expect(
			container.querySelector("[data-pen-selection-toolbar-content]"),
		).not.toBeNull();

		await act(async () => {
			trigger?.dispatchEvent(
				new Event("pointerdown", {
					bubbles: true,
					cancelable: true,
				}),
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const inlineSessionInput = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		expect(inlineSessionInput).toBeTruthy();
		expect(document.activeElement).toBe(inlineSessionInput);
		expect(
			container.querySelector("[data-pen-selection-toolbar-content]"),
		).toBeNull();
		expect(
			container.querySelector(
				"[data-pen-ai-contextual-prompt-selection-overlay]",
			),
		).not.toBeNull();
		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-actions]"),
		).toBeNull();

		await act(async () => {
			const activeSessionId = controller?.getState().activeSessionId ?? null;
			if (activeSessionId) {
				await controller?.runSessionPrompt(activeSessionId, "Rewrite this", {
					target: "selection",
				});
			}
			for (let tick = 0; tick < 6; tick += 1) {
				await Promise.resolve();
			}
		});

		const sessionId = controller?.getState().activeSessionId ?? null;
		const sessionTurns = controller?.getState().sessions[0]?.turns ?? [];
		expect(sessionTurns).toHaveLength(1);
		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-actions]"),
		).not.toBeNull();

		await act(async () => {
			if (sessionId && sessionTurns[0]) {
				controller?.acceptSessionTurn(sessionId, sessionTurns[0].id);
			}
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(editor.getBlock(blockId)?.textContent({ resolved: true })).toBe(
			"Hello planet",
		);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("keeps the inline AI selection overlay visible from the captured session target", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 160,
			width: 120,
			height: 18,
		});
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const trigger = container.querySelector(
			"[data-pen-ai-selection-trigger]",
		) as HTMLButtonElement | null;
		expect(trigger).not.toBeNull();

		await act(async () => {
			trigger?.dispatchEvent(
				new Event("pointerdown", {
					bubbles: true,
					cancelable: true,
				}),
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(
			container.querySelector(
				"[data-pen-ai-contextual-prompt-selection-overlay]",
			),
		).not.toBeNull();
		const initialAffectedRange = container.querySelector(
			"[data-ai-affected-range]",
		) as HTMLElement | null;
		expect(initialAffectedRange).not.toBeNull();
		expect(initialAffectedRange?.textContent).toBe("world");
		expect(
			container.querySelector("[data-pen-ai-inline-session-target-hint]")?.textContent,
		).toBe("AI target is active");

		await act(async () => {
			editor.selectTextRange(
				{ blockId, offset: 0 },
				{ blockId, offset: 0 },
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(
			container.querySelector(
				"[data-pen-ai-contextual-prompt-selection-overlay]",
			),
		).not.toBeNull();
		const preservedAffectedRange = container.querySelector(
			"[data-ai-affected-range]",
		) as HTMLElement | null;
		expect(preservedAffectedRange).not.toBeNull();
		expect(preservedAffectedRange?.textContent).toBe("world");
		expect(
			container.querySelector("[data-pen-ai-inline-session-target-hint]")?.textContent,
		).toBeTruthy();

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("keeps the inline AI session bound to its captured selection", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 160,
			width: 120,
			height: 18,
		});
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
		const controller = getAIController(editor);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const trigger = container.querySelector(
			"[data-pen-ai-selection-trigger]",
		) as HTMLButtonElement | null;
		expect(trigger).not.toBeNull();

		await act(async () => {
			trigger?.dispatchEvent(
				new Event("pointerdown", {
					bubbles: true,
					cancelable: true,
				}),
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(
			container.querySelector("[data-pen-ai-inline-session-target-hint]")?.textContent,
		).toBe("AI target is active");

		await act(async () => {
			editor.selectTextRange(
				{ blockId, offset: 0 },
				{ blockId, offset: 5 },
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		await act(async () => {
			const activeSessionId = controller?.getState().activeSessionId ?? null;
			if (activeSessionId) {
				await controller?.runSessionPrompt(activeSessionId, "Rewrite this", {
					target: "selection",
				});
			}
			for (let tick = 0; tick < 6; tick += 1) {
				await Promise.resolve();
			}
		});

		const sessionId = controller?.getState().activeSessionId ?? null;
		const sessionTurns = controller?.getState().sessions[0]?.turns ?? [];
		expect(sessionTurns).toHaveLength(1);

		await act(async () => {
			if (sessionId && sessionTurns[0]) {
				controller?.acceptSessionTurn(sessionId, sessionTurns[0].id);
			}
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(editor.getBlock(blockId)?.textContent({ resolved: true })).toBe(
			"Hello planet",
		);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("opens a fresh inline session for a new selection instead of reusing old review state", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 160,
			width: 120,
			height: 18,
		});
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
		const controller = getAIController(editor);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		await act(async () => {
			const firstSession = controller?.openContextualPrompt({
				surface: "inline-edit",
				target: "selection",
			});
			if (firstSession) {
				await controller?.runSessionPrompt(firstSession.id, "Rewrite this", {
					target: "selection",
				});
			}
			for (let tick = 0; tick < 6; tick += 1) {
				await Promise.resolve();
			}
		});

		const firstSessionId = controller?.getState().activeSessionId ?? null;
		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-actions]"),
		).not.toBeNull();

		await act(async () => {
			editor.selectTextRange(
				{ blockId, offset: 0 },
				{ blockId, offset: 5 },
			);
			controller?.openContextualPrompt({
				surface: "inline-edit",
				target: "selection",
			});
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const activeSession = controller?.getActiveSession() ?? null;
		expect(activeSession?.id).not.toBe(firstSessionId);
		expect(activeSession?.turns).toHaveLength(0);
		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-actions]"),
		).toBeNull();

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("renders a durable affected-range decoration while the inline session is visible", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 160,
			width: 120,
			height: 18,
		});
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
		const controller = getAIController(editor);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSession />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			controller?.openContextualPrompt({
				surface: "inline-edit",
				target: "selection",
			});
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const decorations = (
			controller as unknown as {
				buildDecorations: () => Array<{ attributes?: Record<string, unknown> }>;
			}
		).buildDecorations();
		expect(
			decorations.some(
				(decoration) => decoration.attributes?.["data-ai-affected-range"] === "",
			),
		).toBe(true);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("does not reopen raw inline UI history through keyboard shortcuts without a turn boundary", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 160,
			width: 120,
			height: 18,
		});
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
		const controller = getAIController(editor);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSession />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			const session = controller?.openContextualPrompt({
				surface: "inline-edit",
				target: "selection",
			});
			if (session) {
				controller?.suspendInlineSession(session.id);
			}
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(container.querySelector("[data-pen-ai-inline-session-input]")).toBeNull();

		await act(async () => {
			document.dispatchEvent(createKeyDownEvent("z", { ctrlKey: true }));
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(container.querySelector("[data-pen-ai-inline-session-input]")).toBeNull();

		await act(async () => {
			document.dispatchEvent(
				createKeyDownEvent("z", { ctrlKey: true, shiftKey: true }),
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(container.querySelector("[data-pen-ai-inline-session-input]")).toBeNull();

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("ignores inline history shortcuts from external textareas", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
		});
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
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);
		const controller = getAIController(editor);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<textarea data-external-chat="" />
						<Pen.AI.InlineSession />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			const session = controller?.openContextualPrompt({
				surface: "inline-edit",
				target: "selection",
			});
			if (session) {
				controller?.suspendInlineSession(session.id);
			}
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const externalTextarea = container.querySelector(
			"[data-external-chat]",
		) as HTMLTextAreaElement | null;
		expect(externalTextarea).not.toBeNull();

		await act(async () => {
			externalTextarea?.focus();
			externalTextarea?.dispatchEvent(createKeyDownEvent("z", { ctrlKey: true }));
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(container.querySelector("[data-pen-ai-inline-session-input]")).toBeNull();

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("opens the inline session from the configured shortcut", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
		});
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
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
						<Pen.AI.InlineSuggestionControls />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			document.dispatchEvent(
				createKeyDownEvent("j", { ctrlKey: true }),
			);
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-session-input]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("ignores selection shortcuts from external textareas", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
		});
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
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<textarea data-external-chat="" />
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		const externalTextarea = container.querySelector(
			"[data-external-chat]",
		) as HTMLTextAreaElement | null;
		expect(externalTextarea).not.toBeNull();

		await act(async () => {
			externalTextarea?.focus();
			externalTextarea?.dispatchEvent(
				createKeyDownEvent("j", { ctrlKey: true }),
			);
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-session-input]"),
		).toBeNull();

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("does not cancel pointer interaction on the inline session textarea", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
		});
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
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			document.dispatchEvent(
				createKeyDownEvent("j", { ctrlKey: true }),
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		expect(textarea).not.toBeNull();

		const pointerDownEvent = new Event("pointerdown", {
			bubbles: true,
			cancelable: true,
		});

		expect(textarea?.dispatchEvent(pointerDownEvent)).toBe(true);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("keeps prompt textarea key events out of editor keyboard handling", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
		});
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
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			document.dispatchEvent(
				createKeyDownEvent("j", { ctrlKey: true }),
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		expect(textarea).not.toBeNull();

		const backspaceEvent = createKeyDownEvent("Backspace");
		await act(async () => {
			textarea?.focus();
			await Promise.resolve();
		});

		expect(textarea?.dispatchEvent(backspaceEvent)).toBe(true);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("rejects and closes the inline session on Escape even when unfocused", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
		});
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
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			document.dispatchEvent(
				createKeyDownEvent("j", { ctrlKey: true }),
			);
			await Promise.resolve();
		});

		const textarea = container.querySelector(
			"[data-pen-ai-inline-session-input]",
		) as HTMLTextAreaElement | null;
		expect(textarea).not.toBeNull();

		await act(async () => {
			(document.body as HTMLElement).focus?.();
			document.dispatchEvent(createKeyDownEvent("Escape"));
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(
			getAIController(editor)?.getState().sessions[0]?.contextualPrompt?.composer.isOpen,
		).toBe(false);

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("shows Accept and Reject on the latest inline prompt turn after submission", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
		});
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

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<Pen.AI.SelectionTrigger shortcut="ctrl+j">
									AI
								</Pen.AI.SelectionTrigger>
							</Pen.SelectionToolbar.Content>
							<Pen.AI.InlineSession />
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		await act(async () => {
			document.dispatchEvent(
				createKeyDownEvent("j", { ctrlKey: true }),
			);
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-accept]"),
		).toBeNull();
		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-reject]"),
		).toBeNull();

		const controller = getAIController(editor);
		await act(async () => {
			const activeSessionId = controller?.getState().activeSessionId ?? null;
			if (activeSessionId) {
				await controller?.runSessionPrompt(activeSessionId, "Rewrite this", {
					target: "selection",
				});
			}
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-accept]"),
		).not.toBeNull();
		expect(
			container.querySelector("[data-pen-ai-inline-session-turn-reject]"),
		).not.toBeNull();

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("closes the inline prompt when resolving a turn from the prompt buttons", async () => {
		async function runResolutionCase(resolution: "accept" | "reject") {
			const restoreSelectionRect = mockSelectionToolbarRect({
				top: 120,
				left: 180,
				width: 80,
				height: 20,
			});
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

			const container = document.createElement("div");
			document.body.appendChild(container);
			const root = createRoot(container);

			await act(async () => {
				root.render(
					<Pen.Editor.Root editor={editor}>
						<Pen.AI.Root editor={editor}>
							<Pen.SelectionToolbar.Root>
								<Pen.SelectionToolbar.Content>
									<Pen.AI.SelectionTrigger shortcut="ctrl+j">
										AI
									</Pen.AI.SelectionTrigger>
								</Pen.SelectionToolbar.Content>
								<Pen.AI.InlineSession />
							</Pen.SelectionToolbar.Root>
						</Pen.AI.Root>
					</Pen.Editor.Root>,
				);
				await Promise.resolve();
			});

			const controller = getAIController(editor);
			await act(async () => {
				document.dispatchEvent(
					createKeyDownEvent("j", { ctrlKey: true }),
				);
				await Promise.resolve();
				const activeSessionId = controller?.getState().activeSessionId ?? null;
				if (activeSessionId) {
					await controller?.runSessionPrompt(activeSessionId, "Rewrite this", {
						target: "selection",
					});
				}
				for (let tick = 0; tick < 4; tick += 1) {
					await Promise.resolve();
				}
			});

			const selector =
				resolution === "accept"
					? "[data-pen-ai-inline-session-turn-accept]"
					: "[data-pen-ai-inline-session-turn-reject]";
			const resolutionButton = container.querySelector(
				selector,
			) as HTMLButtonElement | null;
			expect(resolutionButton).not.toBeNull();

			await act(async () => {
				resolutionButton?.click();
				for (let tick = 0; tick < 4; tick += 1) {
					await Promise.resolve();
				}
			});

			expect(
				container.querySelector("[data-pen-ai-inline-session-input]"),
			).toBeNull();
			expect(
				getAIController(editor)?.getState().sessions[0]?.contextualPrompt?.composer.isOpen,
			).toBe(false);

			await act(async () => {
				root.unmount();
			});
			restoreSelectionRect();
			container.remove();
		}

		await runResolutionCase("accept");
		await runResolutionCase("reject");
	});

	it("reserves document space for inserted contextual prompts", async () => {
		const restoreSelectionRect = mockSelectionToolbarRect({
			top: 120,
			left: 180,
			width: 80,
			height: 20,
		});
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
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.SelectionTrigger shortcut="ctrl+j">
							AI
						</Pen.AI.SelectionTrigger>
						<Pen.AI.ContextualPromptSurface mode="inserted">
							<div>
								<Pen.AI.ContextualPromptComposer />
							</div>
						</Pen.AI.ContextualPromptSurface>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		const blockElement = container.querySelector(
			`[data-block-id="${blockId}"]`,
		) as HTMLElement | null;
		expect(blockElement).not.toBeNull();
		Object.defineProperty(blockElement, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				top: 120,
				left: 120,
				width: 320,
				height: 24,
				right: 440,
				bottom: 144,
				x: 120,
				y: 120,
				toJSON() {
					return this;
				},
			}),
		});

		await act(async () => {
			document.dispatchEvent(
				createKeyDownEvent("j", { ctrlKey: true }),
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		expect(blockElement?.style.marginTop).not.toBe("");
		const insertedPrompt = container.querySelector(
			"[data-pen-ai-inline-session][data-mode=\"inserted\"]",
		) as HTMLElement | null;
		expect(insertedPrompt).not.toBeNull();
		expect(
			container.querySelector(
				"[data-pen-ai-contextual-prompt-selection-overlay]",
			),
		).not.toBeNull();
		expect(
			insertedPrompt?.style.getPropertyValue("--pen-ai-contextual-prompt-top"),
		).not.toBe("0px");

		await act(async () => {
			root.unmount();
		});
		restoreSelectionRect();
		container.remove();
	});

	it("renders local inline suggestion controls for non-session AI diffs", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		await controller?.runPrompt("Rewrite the selection");

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSuggestionControls />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const suggestionIds = [
			...new Set((controller?.getSuggestions() ?? []).map((suggestion) => suggestion.id)),
		];
		expect(suggestionIds.length).toBeGreaterThan(0);

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(editorContent, "clientHeight", {
			configurable: true,
			value: 800,
		});
		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);
		const suggestionRects = suggestionIds.map((_, index) => ({
			top: 180 + Math.floor(index / 3) * 24,
			left: 140 + (index % 3) * 88,
			width: 80,
			height: 18,
		}));

		const suggestionElements = suggestionIds.map((suggestionId, index) => {
			const suggestionAnchor = document.createElement("span");
			suggestionAnchor.setAttribute("data-suggestion-id", suggestionId);
			suggestionAnchor.textContent = "change";
			Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					top: suggestionRects[index]!.top,
					left: suggestionRects[index]!.left,
					width: suggestionRects[index]!.width,
					height: suggestionRects[index]!.height,
					right: suggestionRects[index]!.left + suggestionRects[index]!.width,
					bottom: suggestionRects[index]!.top + suggestionRects[index]!.height,
					x: suggestionRects[index]!.left,
					y: suggestionRects[index]!.top,
					toJSON() {
						return this;
					},
				}),
			});
			if (index > 0) {
				blockElement.appendChild(document.createTextNode(" "));
			}
			blockElement.appendChild(suggestionAnchor);
			return suggestionAnchor;
		});

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		const suggestionControls = container.querySelectorAll(
			"[data-pen-ai-inline-suggestion-control]",
		);
		expect(suggestionControls.length).toBe(1);
		const suggestionCountLabel = container.querySelector(
			"[data-pen-ai-inline-suggestion-count]",
		);
		expect(suggestionCountLabel?.textContent).toBe("1 of 1");
		const suggestionControl = suggestionControls[0] as HTMLDivElement;
		expect(suggestionControl.style.left).toBe("524px");
		const initialTop = suggestionControl.style.top;

		await act(async () => {
			suggestionRects.forEach((rect, index) => {
				rect.left = 240 + (index % 3) * 112;
			});
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-suggestion-count]")?.textContent,
		).toBe("1 of 1");
		expect(
			(
				container.querySelector(
					"[data-pen-ai-inline-suggestion-control]",
				) as HTMLDivElement | null
			)?.style.left,
		).toBe("524px");

		await act(async () => {
			suggestionRects.forEach((rect) => {
				rect.top += 96;
			});
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		expect(
			(
				container.querySelector(
					"[data-pen-ai-inline-suggestion-control]",
				) as HTMLDivElement | null
			)?.style.left,
		).toBe("524px");
		expect(
			(
				container.querySelector(
					"[data-pen-ai-inline-suggestion-control]",
				) as HTMLDivElement | null
			)?.style.top,
		).not.toBe(initialTop);

		const suggestionCountBeforeAccept = controller?.getSuggestions().length ?? 0;
		const keepButton = suggestionControls[0]?.querySelector(
			"[data-pen-ai-inline-suggestion-accept]",
		) as HTMLButtonElement | null;

		await act(() => {
			keepButton?.click();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-suggestion-control]"),
		).toBeNull();

		await act(async () => {
			await Promise.resolve();
		});

		expect((controller?.getSuggestions().length ?? 0)).toBeLessThan(
			suggestionCountBeforeAccept,
		);

		await act(async () => {
			root.unmount();
		});
		for (const suggestionElement of suggestionElements) {
			suggestionElement.remove();
		}
		blockElement.remove();
		container.remove();
	});

	it("keeps inline suggestion controls visible when only part of a group resolves", async () => {
		const editor = createEditor({
			extensions: [aiExtension()],
		});
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);

		const suggestionIds = ["partial-success-a", "partial-success-b"];
		(controller as unknown as { _suggestions: unknown })._suggestions = suggestionIds.map(
			(suggestionId) => ({
				id: suggestionId,
				action: "insert" as const,
				author: "AI",
				authorType: "ai" as const,
				createdAt: Date.now(),
				blockId,
				offset: 0,
				length: 5,
			}),
		);

		const originalAcceptSuggestion = controller!.acceptSuggestion.bind(controller);
		controller!.acceptSuggestion = (suggestionId: string) => suggestionId === suggestionIds[0];

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSuggestionControls />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(editorContent, "clientHeight", {
			configurable: true,
			value: 800,
		});

		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);

		for (const [index, suggestionId] of suggestionIds.entries()) {
			const suggestionAnchor = document.createElement("span");
			suggestionAnchor.setAttribute("data-suggestion-id", suggestionId);
			suggestionAnchor.textContent = "change";
			Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					top: 180,
					left: 140 + index * 88,
					width: 80,
					height: 18,
					right: 220 + index * 88,
					bottom: 198,
					x: 140 + index * 88,
					y: 180,
					toJSON() {
						return this;
					},
				}),
			});
			if (index > 0) {
				blockElement.appendChild(document.createTextNode(" "));
			}
			blockElement.appendChild(suggestionAnchor);
		}

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		const keepButton = container.querySelector(
			"[data-pen-ai-inline-suggestion-accept]",
		) as HTMLButtonElement | null;
		expect(keepButton).not.toBeNull();

		await act(async () => {
			keepButton?.click();
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-suggestion-control]"),
		).not.toBeNull();

		controller!.acceptSuggestion = originalAcceptSuggestion;
		await act(async () => {
			root.unmount();
		});
		blockElement.remove();
		container.remove();
	});

	it("supports custom non-floating inline suggestion keep and undo controls", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		await controller?.runPrompt("Rewrite the selection");

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSuggestionControls asChild>
							<div data-custom-inline-suggestion-toolbar="">
								<Pen.AI.InlineSuggestionCount />
								<Pen.AI.InlineSuggestionReject asChild>
									<button
										type="button"
										data-custom-inline-suggestion-reject=""
									>
										Undo
									</button>
								</Pen.AI.InlineSuggestionReject>
								<Pen.AI.InlineSuggestionAccept asChild>
									<button
										type="button"
										data-custom-inline-suggestion-accept=""
									>
										Keep
									</button>
								</Pen.AI.InlineSuggestionAccept>
							</div>
						</Pen.AI.InlineSuggestionControls>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const suggestionIds = [
			...new Set((controller?.getSuggestions() ?? []).map((suggestion) => suggestion.id)),
		];
		expect(suggestionIds.length).toBeGreaterThan(0);

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(editorContent, "clientHeight", {
			configurable: true,
			value: 800,
		});
		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);

		const suggestionRects = suggestionIds.map((_, index) => ({
			top: 180 + Math.floor(index / 3) * 24,
			left: 140 + (index % 3) * 88,
			width: 80,
			height: 18,
		}));
		const suggestionElements = suggestionIds.map((suggestionId, index) => {
			const suggestionAnchor = document.createElement("span");
			suggestionAnchor.setAttribute("data-suggestion-id", suggestionId);
			suggestionAnchor.textContent = "change";
			Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					top: suggestionRects[index]!.top,
					left: suggestionRects[index]!.left,
					width: suggestionRects[index]!.width,
					height: suggestionRects[index]!.height,
					right: suggestionRects[index]!.left + suggestionRects[index]!.width,
					bottom: suggestionRects[index]!.top + suggestionRects[index]!.height,
					x: suggestionRects[index]!.left,
					y: suggestionRects[index]!.top,
					toJSON() {
						return this;
					},
				}),
			});
			if (index > 0) {
				blockElement.appendChild(document.createTextNode(" "));
			}
			blockElement.appendChild(suggestionAnchor);
			return suggestionAnchor;
		});

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-suggestion-count]")?.textContent,
		).toBe("1 of 1");
		expect(
			container.querySelector("[data-pen-ai-inline-suggestion-control]"),
		).toBeNull();

		const suggestionCountBeforeAccept = controller?.getSuggestions().length ?? 0;
		const keepButton = container.querySelector(
			"[data-custom-inline-suggestion-accept]",
		) as HTMLButtonElement | null;
		expect(keepButton?.disabled).toBe(false);

		await act(() => {
			keepButton?.click();
		});

		await act(async () => {
			await Promise.resolve();
		});

		expect((controller?.getSuggestions().length ?? 0)).toBeLessThan(
			suggestionCountBeforeAccept,
		);

		await act(async () => {
			root.unmount();
		});
		for (const suggestionElement of suggestionElements) {
			suggestionElement.remove();
		}
		blockElement.remove();
		container.remove();
		editor.destroy();
	});

	it("supports custom floating inline suggestion controls built from primitives", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		await controller?.runPrompt("Rewrite the selection");

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSuggestionControls>
							<Pen.AI.InlineSuggestionFloatingSurface>
								<div data-pen-ai-inline-suggestion-nav="">
									<Pen.AI.InlineSuggestionPrevious />
									<Pen.AI.InlineSuggestionCount />
									<Pen.AI.InlineSuggestionNext />
								</div>
								<Pen.AI.InlineSuggestionReject />
								<Pen.AI.InlineSuggestionAccept />
							</Pen.AI.InlineSuggestionFloatingSurface>
						</Pen.AI.InlineSuggestionControls>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const suggestionIds = [
			...new Set((controller?.getSuggestions() ?? []).map((suggestion) => suggestion.id)),
		];
		expect(suggestionIds.length).toBeGreaterThan(0);

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(editorContent, "clientHeight", {
			configurable: true,
			value: 800,
		});
		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);

		const suggestionRects = suggestionIds.map((_, index) => ({
			top: 180 + Math.floor(index / 3) * 24,
			left: 140 + (index % 3) * 88,
			width: 80,
			height: 18,
		}));
		const suggestionElements = suggestionIds.map((suggestionId, index) => {
			const suggestionAnchor = document.createElement("span");
			suggestionAnchor.setAttribute("data-suggestion-id", suggestionId);
			suggestionAnchor.textContent = "change";
			Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					top: suggestionRects[index]!.top,
					left: suggestionRects[index]!.left,
					width: suggestionRects[index]!.width,
					height: suggestionRects[index]!.height,
					right: suggestionRects[index]!.left + suggestionRects[index]!.width,
					bottom: suggestionRects[index]!.top + suggestionRects[index]!.height,
					x: suggestionRects[index]!.left,
					y: suggestionRects[index]!.top,
					toJSON() {
						return this;
					},
				}),
			});
			if (index > 0) {
				blockElement.appendChild(document.createTextNode(" "));
			}
			blockElement.appendChild(suggestionAnchor);
			return suggestionAnchor;
		});

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		const floatingControl = container.querySelector(
			"[data-pen-ai-inline-suggestion-control]",
		) as HTMLDivElement | null;
		expect(floatingControl).not.toBeNull();
		expect(
			floatingControl?.querySelector("[data-pen-ai-inline-suggestion-count]")?.textContent,
		).toBe("1 of 1");

		const suggestionCountBeforeAccept = controller?.getSuggestions().length ?? 0;
		const keepButton = floatingControl?.querySelector(
			"[data-pen-ai-inline-suggestion-accept]",
		) as HTMLButtonElement | null;
		expect(keepButton).not.toBeNull();

		await act(() => {
			keepButton?.click();
		});

		await act(async () => {
			await Promise.resolve();
		});

		expect((controller?.getSuggestions().length ?? 0)).toBeLessThan(
			suggestionCountBeforeAccept,
		);

		await act(async () => {
			root.unmount();
		});
		for (const suggestionElement of suggestionElements) {
			suggestionElement.remove();
		}
		blockElement.remove();
		container.remove();
		editor.destroy();
	});

	it("scopes inline suggestion controls to the active editor root", async () => {
		const secondaryEditor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		await controller?.runPrompt("Rewrite the selection");

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<>
					<Pen.Editor.Root editor={secondaryEditor}>
						<Pen.Editor.Content />
					</Pen.Editor.Root>
					<Pen.Editor.Root editor={editor}>
						<Pen.AI.Root editor={editor}>
							<Pen.Editor.Content />
							<Pen.AI.InlineSuggestionControls>
								<Pen.AI.InlineSuggestionFloatingSurface>
									<div data-pen-ai-inline-suggestion-nav="">
										<Pen.AI.InlineSuggestionPrevious />
										<Pen.AI.InlineSuggestionCount />
										<Pen.AI.InlineSuggestionNext />
									</div>
									<Pen.AI.InlineSuggestionReject />
									<Pen.AI.InlineSuggestionAccept />
								</Pen.AI.InlineSuggestionFloatingSurface>
							</Pen.AI.InlineSuggestionControls>
						</Pen.AI.Root>
					</Pen.Editor.Root>
				</>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const primaryContent = container.querySelector(
			`[data-pen-view-id="${editor.internals.viewId}"] [data-pen-editor-content]`,
		) as HTMLElement | null;
		const secondaryContent = container.querySelector(
			`[data-pen-view-id="${secondaryEditor.internals.viewId}"] [data-pen-editor-content]`,
		) as HTMLElement | null;
		expect(primaryContent).not.toBeNull();
		expect(secondaryContent).not.toBeNull();

		Object.defineProperty(primaryContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(primaryContent, "clientHeight", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(secondaryContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(secondaryContent, "clientHeight", {
			configurable: true,
			value: 800,
		});

		const suggestionId = controller?.getSuggestions()[0]?.id;
		expect(suggestionId).toBeTruthy();

		const rogueBlock = document.createElement("div");
		rogueBlock.setAttribute("data-block-id", "secondary-block");
		secondaryContent?.appendChild(rogueBlock);
		const rogueAnchor = document.createElement("span");
		rogueAnchor.setAttribute("data-suggestion-id", suggestionId!);
		rogueAnchor.textContent = "rogue";
		Object.defineProperty(rogueAnchor, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				top: 24,
				left: 24,
				width: 48,
				height: 18,
				right: 72,
				bottom: 42,
				x: 24,
				y: 24,
				toJSON() {
					return this;
				},
			}),
		});
		rogueBlock.appendChild(rogueAnchor);

		const primaryBlock = document.createElement("div");
		primaryBlock.setAttribute("data-block-id", blockId);
		primaryContent?.appendChild(primaryBlock);
		const primaryAnchor = document.createElement("span");
		primaryAnchor.setAttribute("data-suggestion-id", suggestionId!);
		primaryAnchor.textContent = "real";
		Object.defineProperty(primaryAnchor, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				top: 180,
				left: 140,
				width: 80,
				height: 18,
				right: 220,
				bottom: 198,
				x: 140,
				y: 180,
				toJSON() {
					return this;
				},
			}),
		});
		primaryBlock.appendChild(primaryAnchor);

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		const floatingControl = container.querySelector(
			"[data-pen-ai-inline-suggestion-control]",
		) as HTMLDivElement | null;
		expect(floatingControl).not.toBeNull();
		expect(primaryContent?.contains(floatingControl ?? null)).toBe(true);
		expect(secondaryContent?.contains(floatingControl ?? null)).toBe(false);

		await act(async () => {
			root.unmount();
		});
		rogueAnchor.remove();
		rogueBlock.remove();
		primaryAnchor.remove();
		primaryBlock.remove();
		container.remove();
		secondaryEditor.destroy();
		editor.destroy();
	});

	it("keeps inline suggestion controls visible while a local AI diff is still streaming", async () => {
		const releaseFinalDelta = createDeferred();
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield { type: "text-delta" as const, delta: "planet" };
							await releaseFinalDelta.promise;
							yield { type: "done" as const };
						},
					},
				}),
			],
		});
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSuggestionControls />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		let generationPromise: Promise<unknown> | null = null;
		await act(async () => {
			generationPromise = controller?.runPrompt("Rewrite the selection") ?? null;
			await new Promise((resolve) => setTimeout(resolve, 120));
		});

		const suggestionIds = [
			...new Set((controller?.getSuggestions() ?? []).map((suggestion) => suggestion.id)),
		];
		expect(suggestionIds.length).toBeGreaterThan(0);

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(editorContent, "clientHeight", {
			configurable: true,
			value: 800,
		});

		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);

		for (const [index, suggestionId] of suggestionIds.entries()) {
			const suggestionAnchor = document.createElement("span");
			suggestionAnchor.setAttribute("data-suggestion-id", suggestionId);
			suggestionAnchor.textContent = "change";
			Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					top: 180 + Math.floor(index / 3) * 24,
					left: 140 + (index % 3) * 88,
					width: 80,
					height: 18,
					right: 220 + (index % 3) * 88,
					bottom: 198 + Math.floor(index / 3) * 24,
					x: 140 + (index % 3) * 88,
					y: 180 + Math.floor(index / 3) * 24,
					toJSON() {
						return this;
					},
				}),
			});
			if (index > 0) {
				blockElement.appendChild(document.createTextNode(" "));
			}
			blockElement.appendChild(suggestionAnchor);
		}

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-suggestion-control]"),
		).not.toBeNull();

		await act(async () => {
			releaseFinalDelta.resolve();
			await generationPromise;
		});

		await act(async () => {
			root.unmount();
		});
		blockElement.remove();
		container.remove();
		editor.destroy();
	});

	it("does not auto-scroll the same inline suggestion while the viewport scrolls", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		await controller?.runPrompt("Rewrite the selection");

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSuggestionControls />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const suggestionId = controller?.getSuggestions()[0]?.id;
		expect(suggestionId).toBeTruthy();

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		Object.defineProperty(editorContent, "clientHeight", {
			configurable: true,
			value: 800,
		});

		const scrollContainer = editorContent?.parentElement as HTMLElement | null;
		expect(scrollContainer).not.toBeNull();
		if (!scrollContainer) {
			throw new Error("Expected inline suggestion scroll container");
		}
		scrollContainer.style.overflowY = "auto";
		Object.defineProperty(scrollContainer, "clientHeight", {
			configurable: true,
			value: 220,
		});
		Object.defineProperty(scrollContainer, "scrollHeight", {
			configurable: true,
			value: 1000,
		});

		let scrollTopValue = 0;
		Object.defineProperty(scrollContainer, "scrollTop", {
			configurable: true,
			get: () => scrollTopValue,
			set: (value: number) => {
				scrollTopValue = value;
			},
		});
		Object.defineProperty(scrollContainer, "scrollTo", {
			configurable: true,
			value: ({ top }: { top?: number }) => {
				scrollTopValue = top ?? scrollTopValue;
			},
		});
		Object.defineProperty(scrollContainer, "getBoundingClientRect", {
			configurable: true,
			value: () => ({
				top: 0,
				left: 0,
				width: 800,
				height: 220,
				right: 800,
				bottom: 220,
				x: 0,
				y: 0,
				toJSON() {
					return this;
				},
			}),
		});

		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);

		const suggestionAnchor = document.createElement("span");
		suggestionAnchor.setAttribute("data-suggestion-id", suggestionId!);
		suggestionAnchor.textContent = "change";
		Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
			configurable: true,
			value: () => {
				const top = 320 - scrollTopValue;
				const height = 18;
				const left = 140;
				const width = 80;
				return {
					top,
					left,
					width,
					height,
					right: left + width,
					bottom: top + height,
					x: left,
					y: top,
					toJSON() {
						return this;
					},
				};
			},
		});
		blockElement.appendChild(suggestionAnchor);

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-pen-ai-inline-suggestion-control]"),
		).not.toBeNull();
		expect(scrollTopValue).toBeGreaterThan(0);
		const scrollTopAfterMount = scrollTopValue;

		await act(async () => {
			scrollTopValue = 260;
			window.dispatchEvent(new Event("scroll"));
			await Promise.resolve();
		});

		expect(scrollTopValue).toBe(260);
		expect(scrollTopValue).not.toBe(scrollTopAfterMount);

		await act(async () => {
			root.unmount();
		});
		suggestionAnchor.remove();
		blockElement.remove();
		container.remove();
		editor.destroy();
	});

	it("repositions the selection toolbar when the editor viewport scrolls", async () => {
		const selectionRect = mockMutableSelectionToolbarRect({
			top: 180,
			left: 160,
			width: 120,
			height: 24,
		});
		const editor = createEditor({
			extensions: [aiExtension({ author: "tester" })],
		});
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 0 },
			{ blockId, offset: 5 },
		);

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.SelectionToolbar.Root>
							<Pen.SelectionToolbar.Content>
								<button type="button">AI</button>
							</Pen.SelectionToolbar.Content>
						</Pen.SelectionToolbar.Root>
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			await Promise.resolve();
		});

		const toolbar = container.querySelector(
			"[data-pen-selection-toolbar-content]",
		) as HTMLElement | null;
		expect(toolbar).not.toBeNull();
		if (!toolbar) {
			throw new Error("Expected selection toolbar content");
		}

		const initialTransform = toolbar.style.transform;
		expect(initialTransform).toContain("172px");

		await act(async () => {
			selectionRect.rect.top = 120;
			window.dispatchEvent(new Event("scroll"));
			await Promise.resolve();
		});

		expect(toolbar.style.transform).not.toBe(initialTransform);
		expect(toolbar.style.transform).toContain("112px");

		await act(async () => {
			root.unmount();
		});
		container.remove();
		editor.destroy();
		selectionRect.restore();
	});

	it("mounts Pen.AI.Root AI views without entering an update loop", async () => {
		const editor = createEditor({
			extensions: [aiExtension({ suggestMode: true, author: "tester" })],
		});
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.AI.DiffView />
						<Pen.AI.ChangeList />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
		});

		const initialDiffView = container.querySelector("[data-pen-ai-diff-view]");
		const initialChangeList = container.querySelector("[data-pen-ai-change-list]");
		expect(initialDiffView).not.toBeNull();
		expect(initialChangeList).not.toBeNull();

		const blockId = editor.firstBlock()!.id;
		await act(async () => {
			editor.apply(
				[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
				{ origin: "user" },
			);
		});

		expect(container.querySelector("[data-pen-ai-diff-view]")).toBe(initialDiffView);
		expect(container.querySelector("[data-pen-ai-change-list]")).toBe(initialChangeList);

		await act(async () => {
			controller?.setSuggestMode(true);
			controller?.setSuggestMode(true);
			controller?.closeCommandMenu();
			controller?.dismissEphemeralSuggestion();
		});

		expect(container.querySelector("[data-pen-ai-diff-view]")).toBe(initialDiffView);
		expect(container.querySelector("[data-pen-ai-change-list]")).toBe(initialChangeList);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("renders active inline session controls as a right-edge rail", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Hello world" }],
			{ origin: "system" },
		);
		editor.selectTextRange(
			{ blockId, offset: 6 },
			{ blockId, offset: 11 },
		);

		const session = controller?.startSession({
			surface: "inline-edit",
			target: "selection",
		});
		if (session) {
			await controller?.runSessionPrompt(session.id, "Rewrite the selection");
		}

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
						<Pen.AI.InlineSession />
						<Pen.AI.InlineSuggestionControls />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
			for (let tick = 0; tick < 4; tick += 1) {
				await Promise.resolve();
			}
		});

		const suggestionIds = [
			...new Set((controller?.getSuggestions() ?? []).map((suggestion) => suggestion.id)),
		];
		expect(suggestionIds.length).toBeGreaterThan(0);

		const editorContent = container.querySelector(
			"[data-pen-editor-content]",
		) as HTMLElement | null;
		expect(editorContent).not.toBeNull();
		Object.defineProperty(editorContent, "clientWidth", {
			configurable: true,
			value: 800,
		});
		const blockElement = document.createElement("div");
		blockElement.setAttribute("data-block-id", blockId);
		editorContent?.appendChild(blockElement);

		for (const [index, suggestionId] of suggestionIds.entries()) {
			const suggestionAnchor = document.createElement("span");
			suggestionAnchor.setAttribute("data-suggestion-id", suggestionId);
			suggestionAnchor.textContent = "change";
			Object.defineProperty(suggestionAnchor, "getBoundingClientRect", {
				configurable: true,
				value: () => ({
					top: 220 + index * 20,
					left: 140,
					width: 80,
					height: 18,
					right: 220,
					bottom: 238 + index * 20,
					x: 140,
					y: 220 + index * 20,
					toJSON() {
						return this;
					},
				}),
			});
			blockElement.appendChild(suggestionAnchor);
		}

		await act(async () => {
			window.dispatchEvent(new Event("resize"));
			await Promise.resolve();
		});

		const rail = container.querySelector(
			"[data-pen-ai-inline-suggestion-control][data-placement=\"right-rail\"]",
		) as HTMLDivElement | null;
		expect(rail).not.toBeNull();
		expect(rail?.style.left).toBe("524px");
		expect(
			rail?.querySelector("[data-pen-ai-inline-suggestion-accept]"),
		).toBeNull();
		expect(
			rail?.querySelector("[data-pen-ai-inline-suggestion-reject]"),
		).toBeNull();

		await act(async () => {
			root.unmount();
		});
		blockElement.remove();
		container.remove();
	});

	it("renders streamed tool activity and progress metadata", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.AI.Progress />
						<Pen.AI.ToolStream />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			await controller?.runPrompt("search the document", {
				blockId: editor.firstBlock()!.id,
			});
		});
		await act(async () => {
			await waitForAttributeValue(
				() =>
					container
						.querySelector("[data-pen-ai-progress]")
						?.getAttribute("data-tool-output-count"),
				"2",
			);
		});

		const progress = container.querySelector("[data-pen-ai-progress]");
		const toolStream = container.querySelector("[data-pen-ai-tool-stream]");
		const toolCallOutput = toolStream?.querySelector("[data-tool-call-output]");

		expect(progress?.getAttribute("data-tool-output-count")).toBe("2");
		expect(progress?.getAttribute("data-last-stream-event")).toBe("generation-finish");
		expect(toolStream?.getAttribute("data-tool-call-count")).toBe("1");
		expect(toolStream?.getAttribute("data-running-tool-count")).toBe("0");
		expect(toolStream?.querySelector("[data-tool-call-name]")?.textContent).toBe(
			"test_search",
		);
		expect(toolStream?.querySelector("[data-tool-call-status]")?.textContent).toBe(
			"complete",
		);
		expect(toolStream?.querySelector("[data-tool-call-input]")?.textContent).toContain(
			'"query": "plan"',
		);
		expect(toolCallOutput?.textContent).toContain("searching:plan");
		expect(toolCallOutput?.textContent).toContain('"matches": 2');

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});


	it("renders block structured previews while a block plan is still streaming", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.AI.Progress />
						<Pen.AI.ChangeList />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
		});

		let generationPromise: Promise<unknown> | null = null;
		await act(async () => {
			generationPromise = controller?.runPrompt("Convert block to heading", {
				blockId,
			}) ?? null;
			for (let tick = 0; tick < 6; tick += 1) {
				await Promise.resolve();
			}
		});

		const progress = container.querySelector("[data-pen-ai-progress]");
		const changeList = container.querySelector("[data-pen-ai-change-list]");
		const reviewItemsDuringPreview = container.querySelectorAll("[data-review-item]");

		expect(progress?.getAttribute("data-structured-preview-count")).toBe("1");
		expect(progress?.getAttribute("data-structured-preview-state")).toBe("drafted");
		expect(changeList?.getAttribute("data-review-preview-active")).toBe("");
		expect(reviewItemsDuringPreview).toHaveLength(1);
		expect(reviewItemsDuringPreview[0]?.textContent).toContain("Convert block");
		expect(
			reviewItemsDuringPreview[0]?.querySelector("[data-review-item-kind-label]")
				?.textContent,
		).toBe("Updated");

		await act(async () => {
			releaseSecondDelta.resolve();
			await generationPromise;
		});

		expect(
			Number(progress?.getAttribute("data-structured-preview-patch-count") ?? "0"),
		).toBeGreaterThanOrEqual(3);
		expect(progress?.getAttribute("data-structured-preview-state")).toBe("validated");
		expect(changeList?.getAttribute("data-review-preview-active")).toBeNull();

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});


	it("renders view comparison sections for structural review items", async () => {
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.AI.ChangeList />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			await controller?.runPrompt("Add a grouped list view", {
				blockId: "database-1",
			});
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(
			container.querySelector("[data-review-comparison-section-label]")?.textContent,
		).toBe("View changes");
		expect(
			container.querySelector("[data-review-comparison-kind-label]")?.textContent,
		).toBe("Added");
		expect(
			container.querySelector("[data-review-comparison-label]")?.textContent,
		).toBe("View");

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("renders database target previews from streamed structured plans", async () => {
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
												visibleColumnIds: ["name", "status"],
												columnOrder: ["name", "status"],
												sort: [],
												filter: null,
												groupBy: null,
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
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.AI.StructuredTargetPreview />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			await controller?.runPrompt("Add a grouped list view", {
				blockId: "database-1",
			});
		});
		await act(async () => {
			await Promise.resolve();
		});

		const previewRoot = container.querySelector(
			"[data-pen-ai-structured-target-preview]",
		);
		const databasePreview = container.querySelector(
			'[data-structured-target-kind="database"]',
		);
		const databaseViews = container.querySelectorAll("[data-structured-preview-view]");
		const databaseViewLabels = [...databaseViews].map((item) => item.textContent ?? "");
		const activeDatabaseViews = [...databaseViews].filter((item) =>
			item.hasAttribute("data-active"),
		);

		expect(previewRoot?.getAttribute("data-target-count")).toBe("1");
		expect(databasePreview?.textContent).toContain("Database preview");
		expect(databasePreview?.textContent).toContain("List view");
		expect(databaseViewLabels).toContain("List view");
		expect(databaseViews.length).toBeGreaterThanOrEqual(1);
		expect(activeDatabaseViews.length).toBe(1);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("keeps virtual structured preview targets out of editor block gesture handling", async () => {
		const editor = createEditor({
			extensions: [
				aiExtension({
					model: {
						async *stream() {
							yield {
								type: "text-delta" as const,
								delta: JSON.stringify({
									kind: "review_bundle",
									label: "Insert database",
									reason: "Add a structured data block.",
									plans: [
										{
											kind: "block_insert",
											blockId: "database-preview",
											blockType: "database",
											position: { after: blockId },
										},
										{
											kind: "database_edit",
											blockId: "database-preview",
											steps: [
												{
													op: "add_column",
													column: {
														id: "name",
														title: "Name",
														type: "text",
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
		const blockId = editor.firstBlock()!.id;
		editor.apply(
			[{ type: "insert-text", blockId, offset: 0, text: "Intro" }],
			{ origin: "system" },
		);
		const controller = getAIController(editor);
		expect(controller).toBeTruthy();

		const container = document.createElement("div");
		document.body.appendChild(container);
		const root = createRoot(container);

		await act(async () => {
			root.render(
				<Pen.Editor.Root editor={editor}>
					<Pen.AI.Root editor={editor}>
						<Pen.Editor.Content />
					</Pen.AI.Root>
				</Pen.Editor.Root>,
			);
		});

		await act(async () => {
			await controller?.runPrompt("Insert a database below this block", {
				blockId,
			});
		});

		const virtualTarget = container.querySelector(
			"[data-pen-ai-structured-virtual-target]",
		) as HTMLElement | null;
		const previewItem = virtualTarget?.querySelector(
			"[data-structured-target-preview-item]",
		) as HTMLElement | null;
		expect(virtualTarget).not.toBeNull();
		expect(virtualTarget?.hasAttribute("data-pen-ignore-pointer-gesture")).toBe(true);
		expect(previewItem?.hasAttribute("data-block-id")).toBe(false);

		await act(async () => {
			editor.selectBlock(blockId);
		});
		const selectionBefore = editor.getSelection();

		await act(async () => {
			previewItem?.dispatchEvent(
				new MouseEvent("mousedown", { bubbles: true, button: 0 }),
			);
			previewItem?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
			previewItem?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(editor.getSelection()).toEqual(selectionBefore);

		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

});
