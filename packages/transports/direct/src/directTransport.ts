import type {
	Editor,
	PenStreamPart,
	PenStreamRequest,
	PenTransport,
	Position,
	ToolContext,
	ToolServer,
	ToolRuntime,
	Unsubscribe,
} from "@pen/types";
import { isAsyncIterable, resolveToolExecution } from "@pen/types";

export interface DirectTransportOptions {
	toolRuntime?: ToolRuntime;
	/**
	 * @deprecated Use `toolRuntime`.
	 */
	toolServer?: ToolServer;
	onError?: (error: unknown) => void;
}

export function directTransport(
	options: DirectTransportOptions,
): PenTransport {
	const toolRuntime = options.toolRuntime ?? options.toolServer;
	const { onError } = options;
	if (!toolRuntime) {
		throw new Error("directTransport requires a tool runtime");
	}
	const activeControllers = new Set<AbortController>();

	const transport: PenTransport = {
		async *stream(
			request: PenStreamRequest,
		): AsyncGenerator<PenStreamPart> {
			const controller = new AbortController();
			activeControllers.add(controller);
			const signal = controller.signal;

			try {
				for (const toolCall of request.toolCalls ?? []) {
					if (signal.aborted) break;

					const result = toolRuntime.executeTool(
						toolCall.name,
						toolCall.input,
						createTransportToolContext(request.context, () => { }),
					);

					const resolved = await resolveToolExecution(result);
					if (isAsyncIterable(resolved)) {
						for await (const part of resolved) {
							if (signal.aborted) break;
							yield part as PenStreamPart;
						}
					} else {
						yield {
							type: "tool-output",
							toolCallId: toolCall.toolCallId,
							output: resolved,
						} as PenStreamPart;
					}
				}

				yield { type: "done" } as PenStreamPart;
			} catch (error) {
				onError?.(error);
				yield {
					type: "error",
					errorText: error instanceof Error ? error.message : String(error),
				} as PenStreamPart;
			} finally {
				activeControllers.delete(controller);
			}
		},

		async connect(): Promise<void> {
			// No-op — always connected
		},

		async disconnect(): Promise<void> {
			for (const controller of activeControllers) {
				controller.abort();
			}
			activeControllers.clear();
		},

		get connected(): boolean {
			return true;
		},

		onConnectionChange(
			_callback: (connected: boolean) => void,
		): Unsubscribe {
			return () => { };
		},
	};

	return transport;
}

function createTransportToolContext(
	context: PenStreamRequest["context"],
	emit: (part: PenStreamPart) => void,
): ToolContext {
	let activeZoneId: string | null = null;

	return {
		get editor(): Editor {
			return resolveTransportEditor(context?.editor);
		},
		docId: context?.docId ?? "",
		emit,
		insertBlock(
			blockType: string,
			props: Record<string, unknown>,
			position: Position,
		): string {
			const editor = resolveTransportEditor(context?.editor);
			const blockId = crypto.randomUUID();

			emit({
				type: "block-insert",
				blockId,
				blockType,
				props,
				position,
			});

			editor.apply(
				[{ type: "insert-block", blockId, blockType, props, position }],
				{ origin: "ai" },
			);

			return blockId;
		},
		updateBlock(blockId: string, props: Record<string, unknown>): void {
			const editor = resolveTransportEditor(context?.editor);

			emit({ type: "block-update", blockId, props });
			editor.apply([{ type: "update-block", blockId, props }], {
				origin: "ai",
			});
		},
		deleteBlock(blockId: string): void {
			const editor = resolveTransportEditor(context?.editor);

			emit({ type: "block-delete", blockId });
			editor.apply([{ type: "delete-block", blockId }], { origin: "ai" });
		},
		beginStreaming(zoneId: string, blockId: string): void {
			activeZoneId = zoneId;
			emit({ type: "gen-start", zoneId, blockId });
		},
		appendDelta(delta: string): void {
			if (!activeZoneId) {
				throw new Error("appendDelta() called before beginStreaming()");
			}
			emit({ type: "gen-delta", zoneId: activeZoneId, delta });
		},
		endStreaming(status: "complete" | "cancelled" | "error"): void {
			if (!activeZoneId) {
				throw new Error("endStreaming() called before beginStreaming()");
			}
			emit({ type: "gen-end", zoneId: activeZoneId, status });
			activeZoneId = null;
		},
	};
}

function resolveTransportEditor(editor: unknown): Editor {
	if (isEditor(editor)) {
		return editor;
	}
	throw new Error("Transport tool context requires a valid editor");
}

function isEditor(value: unknown): value is Editor {
	return (
		typeof value === "object" &&
		value !== null &&
		"apply" in value &&
		"internals" in value
	);
}
