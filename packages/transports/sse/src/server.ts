import type {
	Editor,
	PenStreamPart,
	PenStreamRequest,
	Position,
	ToolContext,
} from "@pen/types";
import { isAsyncIterable, resolveToolExecution } from "@pen/types";
import type { SSEServerOptions } from "./types";

export function createSSEHandler(
	options: SSEServerOptions,
): (request: Request) => Response | Promise<Response> {
	const toolRuntime = options.toolRuntime ?? options.toolServer;
	const {
		editor: _editor,
		onRequest,
		onError,
		pingInterval = 15_000,
	} = options;

	const streamHistories = new Map<
		string,
		Array<{ id: string; data: string }>
	>();

	return async (request: Request): Promise<Response> => {
		if (request.method === "GET") {
			return handleReconnect(request, streamHistories);
		}

		const body = (await request.json()) as PenStreamRequest;
		onRequest?.(body);

		const streamId = crypto.randomUUID();
		let eventIndex = 0;

		const history: Array<{ id: string; data: string }> = [];
		streamHistories.set(streamId, history);

		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				let pingTimer: ReturnType<typeof setInterval> | null = null;

				const send = (part: PenStreamPart): void => {
					const id = `${streamId}:${eventIndex++}`;
					const data = JSON.stringify(part);

					history.push({ id, data });
					if (history.length > 1000) history.shift();

					const event = `id: ${id}\ndata: ${data}\n\n`;
					controller.enqueue(encoder.encode(event));
				};

				const sendPing = (): void => {
					send({ type: "ping" } as PenStreamPart);
				};

				try {
					pingTimer = setInterval(sendPing, pingInterval);

					if (toolRuntime && body.toolCalls) {
						for (const toolCall of body.toolCalls) {
							const result = toolRuntime.executeTool(
								toolCall.name,
								toolCall.input,
								createTransportToolContext(body.context, send),
							);

							const resolved = await resolveToolExecution(result);
							if (isAsyncIterable(resolved)) {
								for await (const part of resolved) {
									send(part as PenStreamPart);
								}
							} else {
								send({
									type: "tool-output",
									toolCallId: toolCall.toolCallId,
									output: resolved,
								} as PenStreamPart);
							}
						}
					}

					send({ type: "done" } as PenStreamPart);
				} catch (error) {
					onError?.(error);
					send({
						type: "error",
						errorText:
							error instanceof Error ? error.message : String(error),
					} as PenStreamPart);
				} finally {
					if (pingTimer) clearInterval(pingTimer);
					controller.close();
				}
			},
		});

		return new Response(stream, {
			status: 200,
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
				"X-Stream-Id": streamId,
			},
		});
	};
}

function handleReconnect(
	request: Request,
	_streamHistories: Map<string, Array<{ id: string; data: string }>>,
): Response {
	const lastEventId = request.headers.get("Last-Event-ID");
	if (!lastEventId) {
		return new Response("Missing Last-Event-ID", { status: 400 });
	}

	return new Response("Replay not supported for this transport", {
		status: 501,
		headers: { "X-Replay-Supported": "false" },
	});
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
