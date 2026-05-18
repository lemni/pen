import { anthropic } from "@ai-sdk/anthropic";
import {
	docs as collaborationDocs,
	setupWSConnection,
} from "@y/websocket-server/utils";
import {
	generateText,
	jsonSchema,
	Output,
	stepCountIs,
	streamText,
	tool,
} from "ai";
import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import * as Y from "yjs";
import { createHeadlessEditor } from "@pen/core";
import {
	encodeYjsStateVectorBase64,
	ensureExtensionRoot,
	getYjsDoc,
	readExtensionRoot,
} from "@pen/crdt-yjs";
import { exportPlainText } from "@pen/export-json";
import {
	buildPlaygroundRequestPlan as buildSharedPlaygroundRequestPlan,
	buildExplicitLocalOperationPrompt,
	buildPromptContext as buildSharedPromptContext,
	buildStructuredIntentModelPrompt,
	createPlaygroundRequestMetricsSeed,
	getStructuredIntentOutputSchema,
	parseStructuredIntentRequestPrompt,
} from "@pen/ai";
import {
	AI_SUGGESTIONS_REQUEST_MODE,
	AI_SUGGESTIONS_SYSTEM_PROMPT,
	parseSuggestionResponse,
} from "@pen/ai-suggestions";
import {
	AUTOCOMPLETE_SYSTEM_PROMPT,
	getAutocompleteController,
} from "@pen/ai-autocomplete";
import {
	AIToolContextImpl,
	executeAITool,
	getAIToolRuntime,
	listAITools,
} from "@pen/ai-tools";
import { listDefaultAISkills, renderSkillFiles } from "@pen/ai-skills";
import { defaultPreset } from "@pen/preset-default";
import { createDefaultSchema } from "@pen/schema-default";
import type { Editor, ModelRequestedOperation, ToolRuntime } from "@pen/types";
import {
	isScopedSelectionTarget,
	renderSelectionTargetText,
	resolveSelectionTargetBlockIds,
} from "@pen/types";
import {
	parseSerializedEditorState,
	type SerializedBlock,
	type SerializedEditorState,
	type SerializedSelection,
} from "./utils/sessionSyncValidation";
import { buildTableSnapshotOps } from "./utils/tableSnapshot";
import {
	LOCAL_OPERATION_PAYLOAD_END,
	LOCAL_OPERATION_PAYLOAD_START,
	createLocalOperationPayloadCollector,
} from "./utils/localOperationPayload";

loadEnv({
	path: fileURLToPath(new URL("../.env.local", import.meta.url)),
});

const PLAYGROUND_SERVER_HOST = process.env.PLAYGROUND_AI_HOST ?? "127.0.0.1";
const PLAYGROUND_SERVER_PORT = Number(process.env.PLAYGROUND_AI_PORT ?? "8787");
const PLAYGROUND_COLLAB_ROUTE_PREFIX = "/collaboration";
const PLAYGROUND_COLLAB_DEFAULT_DOC_NAME = "pen-playground";
const PLAYGROUND_DOCUMENT_MODEL = normalizePlaygroundModelName(
	process.env.PLAYGROUND_AI_MODEL,
);
const PLAYGROUND_SELECTION_MODEL = normalizePlaygroundSelectionModelName(
	process.env.PLAYGROUND_AI_SELECTION_MODEL,
);
const PLAYGROUND_SELECTION_FAST_PATH_SYSTEM_PROMPT =
	"You are the local AI rewrite engine for the Pen editor. " +
	"Return only the exact replacement text for the current selection. " +
	"Do not add commentary, labels, markdown fences, or quotation marks around the answer.";
const PLAYGROUND_AUTOCOMPLETE_OUTPUT_TOKEN_CAP = 128;
const PLAYGROUND_DOCUMENT_SYSTEM_PROMPT =
	"You are the local AI assistant for the Pen playground. " +
	"Return only the document content to insert into the editor, wrapped in <pen_local_operation>...</pen_local_operation> tags. " +
	"The resolved operation envelope in the prompt is authoritative for scope, placement, and replace-vs-remove behavior. " +
	"If the operation requests removal, return an empty payload wrapper with no refusal text. " +
	"Do not add commentary, analysis, or assistant framing outside the tags. " +
	"Use markdown for headings and structure within the payload wrapper.";
const PLAYGROUND_STRUCTURED_PLANNER_SYSTEM_PROMPT =
	"You are the structured intent generator for the Pen playground. " +
	"Return exactly one valid Pen structured intent object as JSON. " +
	"Do not include markdown fences, explanatory prose, or conversational text.";
const SESSION_HEADER = "x-pen-playground-session";
const PLAYGROUND_SESSION_TTL_MS = 15 * 60 * 1000;
const PLAYGROUND_SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;
const PLAYGROUND_MAX_TOOL_STEPS = 4;
const PLAYGROUND_DEBUG_LOGS = process.env.PLAYGROUND_AI_DEBUG === "true";
const PLAYGROUND_SELECTION_SOURCE_CHAR_LIMIT = 12_000;
const PLAYGROUND_SELECTION_OUTPUT_TOKEN_CAP = 1_200;
const PLAYGROUND_SELECTION_DEFAULT_OUTPUT_TOKENS = 128;
const PLAYGROUND_SELECTION_EXPAND_OUTPUT_TOKENS = 640;
const PLAYGROUND_SELECTION_SUMMARIZE_OUTPUT_TOKENS = 160;
const PLAYGROUND_SELECTION_TRANSLATE_OUTPUT_TOKENS = 480;
const PLAYGROUND_SELECTION_STOP_SENTINEL = "<pen:end>";
const PLAYGROUND_LOCAL_REWRITE_SYSTEM_PROMPT =
	"You are a precise local editor operation. Return only the final replacement content for the requested target inside the required payload wrapper. Do not include analysis, narration, tool chatter, labels, or quotes outside the wrapper.";
const PLAYGROUND_LOCAL_CONTINUE_SYSTEM_PROMPT =
	"You are a precise local editor operation. Return only the continuation text that should be inserted at the requested cursor position inside the required payload wrapper. Do not repeat the existing content, and do not include analysis, narration, tool chatter, labels, or quotes outside the wrapper.";
const PLAYGROUND_SKILLS_ROUTE = "/api/skills";
const PLAYGROUND_TOOL_ROUTE_PREFIX = "/api/tools/";
const PLAYGROUND_SESSION_DIAGNOSTICS_ROUTE = "/api/ai/session/diagnostics";
const PLAYGROUND_EXTENSION_ROOT_NAMESPACE = "pen.playground";
const PLAYGROUND_EXTENSION_ROOT_VERSION = 1;
const PLAYGROUND_DIRECT_TOOL_NAMES = new Set([
	"get_context",
	"read_document",
	"search_document",
	"list_block_types",
]);

interface AIRequestBody {
	prompt?: unknown;
	sessionId?: unknown;
	contextFormat?: unknown;
	requestMode?: unknown;
	operation?: unknown;
	expectedSyncRevision?: unknown;
	expectedSyncedGeneration?: unknown;
	suggestionScope?: unknown;
}

interface ToolExecuteBody {
	input?: unknown;
}

interface SessionCreateResponse {
	sessionId: string;
}

interface SessionDiagnosticsResponse {
	sessionId: string;
	headless: true;
	blockCount: number;
	generation: number;
	plainText: string;
	stateVector: string;
	extensionRoot: {
		namespace: string;
		version: number;
		requestCount: number;
		lastRequestMode: string | null;
		lastSyncedRevision: number | null;
	};
}

interface SessionSyncBody {
	sessionId?: unknown;
	editorState?: unknown;
	revision?: unknown;
	generation?: unknown;
}

interface PlaygroundSession {
	id: string;
	editor: Editor;
	clientToServerBlockIds: Map<string, string>;
	createdAt: number;
	lastTouchedAt: number;
	lastSyncedAt: number | null;
	syncedRevision: number | null;
	syncedGeneration: number | null;
	activeRequestCount: number;
}

interface PlaygroundRequestMetrics {
	requestId: string;
	sessionId: string;
	requestMode: PlaygroundRequestMode;
	requestModel: string;
	contextFormat: PlaygroundResolvedContextFormat;
	startedAt: number;
	firstToolStartMs: number | null;
	firstToolResultMs: number | null;
	firstTextDeltaServerMs: number | null;
	totalServerMs: number | null;
	toolCallCount: number;
	toolExecutionMs: number;
	contextBytesJson: number | null;
	contextEstimatedTokensJson: number | null;
}

interface PromptContextEnvelope {
	json: string;
	jsonBytes: number;
	estimatedJsonTokens: number;
}

interface AISuggestionRequestScope {
	blockType: string | null;
	targetText: string;
	contextBefore: string;
	contextAfter: string;
}

type PlaygroundRequestMode =
	| "document-agent"
	| "structured-generation"
	| "selection-fast"
	| "inline-autocomplete";
type PlaygroundRequestedMode =
	| PlaygroundRequestMode
	| "bottom-chat"
	| "inline-edit"
	| "structured-planner";
type PlaygroundResolvedContextFormat = "json" | "none";

interface PlaygroundRequestPlan {
	mode: PlaygroundRequestMode;
	modelId: string;
	contextFormat: PlaygroundResolvedContextFormat;
	systemPrompt: string;
	prompt: string;
	maxOutputTokens?: number;
	temperature?: number;
	stopSequences?: string[];
	useTools: boolean;
	promptContext: PromptContextEnvelope | null;
	selectedTextLength: number | null;
}

const buildTypedSharedPlaygroundRequestPlan =
	buildSharedPlaygroundRequestPlan as (
		editor: Editor,
		prompt: string,
		config: {
			documentModel: string;
			selectionModel: string;
			documentSystemPrompt: string;
			structuredPlannerSystemPrompt: string;
			selectionFastPathSystemPrompt: string;
			autocompleteSystemPrompt: string;
			selectionSourceCharLimit: number;
			selectionStopSentinel: string;
			selectionOutputTokenCap: number;
			autocompleteOutputTokenCap: number;
			selectionDefaultOutputTokens: number;
			selectionExpandOutputTokens: number;
			selectionSummarizeOutputTokens: number;
			selectionTranslateOutputTokens: number;
		},
		requestedMode?: PlaygroundRequestMode | null,
		requestedOperation?: ModelRequestedOperation | null,
	) => PlaygroundRequestPlan;

const sessions = new Map<string, PlaygroundSession>();
const serverOrigin = `http://${PLAYGROUND_SERVER_HOST}:${PLAYGROUND_SERVER_PORT}`;
const sessionCleanupTimer = setInterval(
	cleanupIdleSessions,
	PLAYGROUND_SESSION_CLEANUP_INTERVAL_MS,
);
sessionCleanupTimer.unref?.();
const collaborationWebSocketServer = new WebSocketServer({ noServer: true });

const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", serverOrigin);

		if (url.pathname === "/health") {
			sendJson(res, 200, {
				ok: true,
				collaboration: {
					documents: collaborationDocs.size,
					connections: Array.from(collaborationDocs.values()).reduce(
						(total, doc) => total + doc.conns.size,
						0,
					),
				},
			});
			return;
		}

		if (url.pathname === "/api/ai" && req.method === "POST") {
			await handleAIRequest(req, res);
			return;
		}

		if (url.pathname === "/api/ai/session" && req.method === "POST") {
			handleCreateSession(res);
			return;
		}

		if (url.pathname === "/api/ai/session/sync" && req.method === "POST") {
			await handleSessionSync(req, res);
			return;
		}

		if (
			url.pathname === PLAYGROUND_SESSION_DIAGNOSTICS_ROUTE &&
			req.method === "GET"
		) {
			handleSessionDiagnosticsRequest(req, res, url);
			return;
		}

		if (url.pathname === "/api/tools" && req.method === "GET") {
			handleListToolsRequest(req, res);
			return;
		}

		if (url.pathname === PLAYGROUND_SKILLS_ROUTE && req.method === "GET") {
			handleListSkillsRequest(req, res);
			return;
		}

		if (
			url.pathname.startsWith(PLAYGROUND_TOOL_ROUTE_PREFIX) &&
			req.method === "POST"
		) {
			await handleDirectToolRequest(req, res, url);
			return;
		}

		sendJson(res, 404, { error: "Not found" });
	} catch (error) {
		sendJson(res, 500, { error: formatError(error) });
	}
});

let isShuttingDown = false;

server.on("error", (error) => {
	console.error("Pen playground AI backend server error:", error);
});

server.on("upgrade", (request, socket, head) => {
	handleCollaborationUpgrade(request, socket, head);
});

server.listen(PLAYGROUND_SERVER_PORT, PLAYGROUND_SERVER_HOST, () => {
	console.log(`Pen playground AI backend listening on ${serverOrigin}`);
});

collaborationWebSocketServer.on(
	"connection",
	(socket: WebSocket, request: IncomingMessage) => {
		setupWSConnection(socket, request, {
			docName: resolveCollaborationDocName(request),
			gc: true,
		});
	},
);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
	process.once(signal, () => {
		shutdownPlaygroundServer(signal);
	});
}

function handleCreateSession(res: ServerResponse): void {
	const session = createPlaygroundSession();
	logPlaygroundEvent("session:create", {
		sessionId: session.id,
	});
	sendJson(res, 200, {
		sessionId: session.id,
	} satisfies SessionCreateResponse);
}

function handleSessionDiagnosticsRequest(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
): void {
	const sessionId =
		url.searchParams.get("sessionId")?.trim() ??
		readHeader(req, SESSION_HEADER);
	if (!sessionId) {
		sendJson(res, 400, {
			error: "Expected a valid playground session ID.",
		});
		return;
	}

	const session = sessions.get(sessionId) ?? null;
	if (!session) {
		sendJson(res, 404, { error: "Playground session not found." });
		return;
	}

	sendJson(res, 200, { ...createSessionDiagnostics(session) });
}

async function handleSessionSync(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const body = (await readJsonBody<SessionSyncBody>(req)) ?? {};
	const sessionId =
		typeof body.sessionId === "string" ? body.sessionId : null;
	const editorState = parseSerializedEditorState(body.editorState);
	const revision =
		typeof body.revision === "number" &&
		Number.isInteger(body.revision) &&
		body.revision >= 0
			? body.revision
			: null;
	const generation =
		typeof body.generation === "number" &&
		Number.isInteger(body.generation) &&
		body.generation >= 0
			? body.generation
			: null;

	if (!sessionId) {
		logPlaygroundEvent("session:sync-rejected", {
			reason: "missing-session-id",
		});
		sendJson(res, 400, {
			error: "Expected a valid playground session ID.",
		});
		return;
	}

	if (!editorState) {
		logPlaygroundEvent("session:sync-rejected", {
			sessionId,
			reason: "missing-editor-state",
		});
		sendJson(res, 400, {
			error: "Expected a serialized editor state payload.",
		});
		return;
	}
	if (revision == null || generation == null) {
		sendJson(res, 400, {
			error: "Expected synchronized revision and generation metadata.",
		});
		return;
	}

	const session = sessions.get(sessionId) ?? null;
	if (!session) {
		logPlaygroundEvent("session:sync-rejected", {
			sessionId,
			reason: "session-not-found",
		});
		sendJson(res, 404, { error: "Playground session not found." });
		return;
	}

	if (session.activeRequestCount > 0) {
		logPlaygroundEvent("session:sync-rejected", {
			sessionId,
			reason: "active-request",
			activeRequestCount: session.activeRequestCount,
		});
		sendJson(res, 409, {
			error: "Cannot sync a playground session while an AI request is active.",
		});
		return;
	}

	const nextEditor = createPlaygroundEditor();
	const clientToServerBlockIds = hydrateEditor(nextEditor, editorState);
	const syncedGeneration = nextEditor.documentState.generation;

	const previousEditor = session.editor;
	session.editor = nextEditor;
	session.clientToServerBlockIds = clientToServerBlockIds;
	session.lastSyncedAt = Date.now();
	session.syncedRevision = revision;
	session.syncedGeneration = syncedGeneration;
	recordPlaygroundSessionSync(session);
	touchSession(session);
	previousEditor.destroy();
	logPlaygroundEvent("session:sync-complete", {
		sessionId: session.id,
		blockCount: editorState.blockCount,
	});

	sendJson(res, 200, {
		sessionId: session.id,
		lastSyncedAt: session.lastSyncedAt,
		revision: session.syncedRevision,
		generation: session.syncedGeneration,
	});
}

async function handleAIRequest(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	if (!process.env.ANTHROPIC_API_KEY) {
		logPlaygroundEvent("ai:request-rejected", {
			reason: "missing-api-key",
		});
		sendJson(res, 500, {
			error: "Missing ANTHROPIC_API_KEY. Add it to playground/.env.local before starting the backend.",
		});
		return;
	}

	const body = (await readJsonBody<AIRequestBody>(req)) ?? {};
	const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
	const sessionId =
		typeof body.sessionId === "string" ? body.sessionId : null;
	const isAISuggestionsRequest =
		body.requestMode === AI_SUGGESTIONS_REQUEST_MODE;
	const suggestionScope = parseAISuggestionRequestScope(body.suggestionScope);
	const requestedMode = parsePlaygroundRequestMode(body.requestMode);
	const requestedOperation = parseRequestedOperation(body.operation);
	const expectedSyncRevision =
		typeof body.expectedSyncRevision === "number" &&
		Number.isInteger(body.expectedSyncRevision) &&
		body.expectedSyncRevision >= 0
			? body.expectedSyncRevision
			: null;
	const expectedSyncedGeneration =
		typeof body.expectedSyncedGeneration === "number" &&
		Number.isInteger(body.expectedSyncedGeneration) &&
		body.expectedSyncedGeneration >= 0
			? body.expectedSyncedGeneration
			: null;

	if (!isAISuggestionsRequest && !prompt) {
		logPlaygroundEvent("ai:request-rejected", {
			reason: "empty-prompt",
		});
		sendJson(res, 400, { error: "Expected a non-empty prompt." });
		return;
	}

	if (isAISuggestionsRequest && !suggestionScope) {
		sendJson(res, 400, {
			error: "Expected a valid AI suggestions scope payload.",
		});
		return;
	}

	if (!sessionId) {
		logPlaygroundEvent("ai:request-rejected", {
			reason: "missing-session-id",
		});
		sendJson(res, 400, {
			error: "Expected a valid playground session ID.",
		});
		return;
	}

	const session = sessions.get(sessionId) ?? null;
	if (!session) {
		logPlaygroundEvent("ai:request-rejected", {
			sessionId,
			reason: "session-not-found",
		});
		sendJson(res, 404, { error: "Playground session not found." });
		return;
	}

	if (session.activeRequestCount > 0) {
		logPlaygroundEvent("ai:request-rejected", {
			sessionId,
			reason: "active-request",
			activeRequestCount: session.activeRequestCount,
		});
		sendJson(res, 409, {
			error: "This playground session already has an active AI request.",
		});
		return;
	}
	if (
		expectedSyncRevision != null &&
		session.syncedRevision != null &&
		expectedSyncRevision !== session.syncedRevision
	) {
		sendJson(res, 409, {
			error: "The playground AI session is out of sync with the editor state.",
		});
		return;
	}
	if (
		expectedSyncedGeneration != null &&
		session.syncedGeneration != null &&
		expectedSyncedGeneration !== session.syncedGeneration
	) {
		sendJson(res, 409, {
			error: "The playground AI session is out of sync with the editor document.",
		});
		return;
	}

	session.activeRequestCount += 1;
	touchSession(session);
	const abortController = new AbortController();
	const requestId = randomUUID();
	const resolvedOperation =
		requestedOperation != null
			? remapRequestedOperationBlockIds(
					requestedOperation,
					session.clientToServerBlockIds,
				)
			: null;
	const requestPlan = buildPlaygroundRequestPlan(
		session.editor,
		prompt,
		resolveOperationRequestMode(resolvedOperation, requestedMode),
		resolvedOperation,
	);
	const structuredIntentRequest = resolvedOperation
		? null
		: parseStructuredIntentRequestPrompt(prompt);
	const metrics: PlaygroundRequestMetrics = {
		requestId,
		sessionId,
		startedAt: performance.now(),
		...createPlaygroundRequestMetricsSeed(requestPlan),
	};
	recordPlaygroundRequestMetadata(session, requestId, requestPlan.mode);
	const abortActiveRequest = () => {
		if (abortController.signal.aborted || res.writableEnded) {
			return;
		}
		abortController.abort();
		logPlaygroundEvent("ai:request-abort-signal", {
			requestId,
			sessionId,
		});
	};

	req.on("aborted", abortActiveRequest);
	req.on("close", abortActiveRequest);
	res.on("close", abortActiveRequest);

	try {
		if (isAISuggestionsRequest && suggestionScope) {
			const result = await generateText({
				model: createPlaygroundLanguageModel(
					PLAYGROUND_SELECTION_MODEL,
				),
				system: AI_SUGGESTIONS_SYSTEM_PROMPT,
				prompt: JSON.stringify(
					{
						language: "en",
						blockType: suggestionScope.blockType,
						targetText: suggestionScope.targetText,
						contextBefore: suggestionScope.contextBefore,
						contextAfter: suggestionScope.contextAfter,
						rules: {
							maxSuggestions: 3,
							allowedKinds: [
								"spelling",
								"grammar",
								"rephrase",
								"clarity",
							],
						},
					},
					null,
					2,
				),
				temperature: 0,
				abortSignal: abortController.signal,
			});
			sendJson(res, 200, {
				suggestions: parseSuggestionResponse(result.text),
				usage: {
					promptTokens: resolveUsageTokenValue(
						result.usage,
						"inputTokens",
					),
					completionTokens: resolveUsageTokenValue(
						result.usage,
						"outputTokens",
					),
				},
			});
			return;
		}

		logPlaygroundEvent("ai:request-start", {
			requestId,
			sessionId,
			mode: requestPlan.mode,
			model: requestPlan.modelId,
			contextFormatResolved: requestPlan.contextFormat,
			promptLength: prompt.length,
			maxOutputTokens: requestPlan.maxOutputTokens ?? null,
			temperature: requestPlan.temperature ?? null,
			stopSequenceCount: requestPlan.stopSequences?.length ?? 0,
			selectedTextLength: requestPlan.selectedTextLength,
			contextBytesJson: metrics.contextBytesJson,
			contextEstimatedTokensJson: metrics.contextEstimatedTokensJson,
		});

		res.writeHead(200, {
			"content-type": "application/x-ndjson; charset=utf-8",
			"cache-control": "no-cache, no-transform",
			connection: "keep-alive",
		});

		writeJsonLine(res, {
			type: "meta",
			requestId,
			sessionId,
			requestMode: requestPlan.mode,
			requestModel: requestPlan.modelId,
			contextFormat: requestPlan.contextFormat,
		});
		writeJsonLine(res, { type: "phase", phase: "thinking" });

		const isLocalOperation =
			resolvedOperation != null &&
			(resolvedOperation.kind === "rewrite-selection" ||
				resolvedOperation.kind === "rewrite-block" ||
				resolvedOperation.kind === "continue-block" ||
				(resolvedOperation.kind === "document-transform" &&
					resolvedOperation.target.kind === "document" &&
					(resolvedOperation.target.transform === "rewrite" ||
						resolvedOperation.target.transform === "remove" ||
						resolvedOperation.target.placement ===
							"replace-blocks")));

		if (isLocalOperation) {
			await streamLocalOperationResponse({
				res,
				editor: session.editor,
				prompt,
				operation: resolvedOperation,
				requestedMode:
					body.requestMode === "bottom-chat" ||
					body.requestMode === "inline-edit" ||
					body.requestMode === "structured-planner"
						? body.requestMode
						: requestedMode,
				requestPlan,
				abortSignal: abortController.signal,
				metrics,
				requestId,
				sessionId,
			});
		} else if (structuredIntentRequest) {
			const structuredChunkTypePrefix =
				structuredIntentRequest.targetKind === "table" ? "grid" : "app";
			const result = streamText({
				model: createPlaygroundLanguageModel(requestPlan.modelId),
				system: requestPlan.systemPrompt,
				prompt: buildStructuredIntentModelPrompt(
					structuredIntentRequest,
				),
				output: Output.object({
					schema: jsonSchema(
						getStructuredIntentOutputSchema(
							structuredIntentRequest.targetKind,
						),
					),
				}),
				...(requestPlan.maxOutputTokens != null
					? { maxOutputTokens: requestPlan.maxOutputTokens }
					: {}),
				...(requestPlan.temperature != null
					? { temperature: requestPlan.temperature }
					: {}),
				abortSignal: abortController.signal,
			});
			for await (const partial of result.partialOutputStream) {
				if (metrics.firstTextDeltaServerMs == null) {
					metrics.firstTextDeltaServerMs =
						performance.now() - metrics.startedAt;
					logPlaygroundEvent("ai:first-structured-partial", {
						requestId,
						sessionId,
						elapsedMs: roundMs(metrics.firstTextDeltaServerMs),
					});
				}
				writeJsonLine(res, { type: "phase", phase: "writing" });
				writeJsonLine(res, {
					type: `${structuredChunkTypePrefix}-partial`,
					data: partial,
				});
			}
			writeJsonLine(res, {
				type: `${structuredChunkTypePrefix}-final`,
				data: await result.output,
			});
		} else {
			const result = streamText({
				model: createPlaygroundLanguageModel(requestPlan.modelId),
				system: requestPlan.systemPrompt,
				prompt: requestPlan.prompt,
				...(requestPlan.useTools
					? {
							tools: buildPlaygroundTools(
								session.editor,
								metrics,
							),
							stopWhen: stepCountIs(PLAYGROUND_MAX_TOOL_STEPS),
						}
					: {}),
				...(requestPlan.maxOutputTokens != null
					? { maxOutputTokens: requestPlan.maxOutputTokens }
					: {}),
				...(requestPlan.temperature != null
					? { temperature: requestPlan.temperature }
					: {}),
				...(requestPlan.stopSequences
					? { stopSequences: requestPlan.stopSequences }
					: {}),
				abortSignal: abortController.signal,
			});

			const shouldStreamRawText =
				requestPlan.mode === "inline-autocomplete";
			const documentPayloadCollector = shouldStreamRawText
				? null
				: createLocalOperationPayloadCollector();
			let lastSentLength = 0;
			for await (const part of result.fullStream) {
				if (part.type === "tool-call") {
					if (metrics.firstToolStartMs == null) {
						metrics.firstToolStartMs =
							performance.now() - metrics.startedAt;
						logPlaygroundEvent("ai:first-tool-call", {
							requestId,
							sessionId,
							toolName: part.toolName,
							elapsedMs: roundMs(metrics.firstToolStartMs),
						});
					}
					metrics.toolCallCount += 1;
					writeJsonLine(res, {
						type: "phase",
						phase: "tool-calling",
					});
					continue;
				}

				if (part.type === "text-delta") {
					if (metrics.firstTextDeltaServerMs == null) {
						metrics.firstTextDeltaServerMs =
							performance.now() - metrics.startedAt;
						logPlaygroundEvent("ai:first-text-delta", {
							requestId,
							sessionId,
							elapsedMs: roundMs(metrics.firstTextDeltaServerMs),
						});
					}
					if (shouldStreamRawText) {
						writeJsonLine(res, { type: "phase", phase: "writing" });
						writeJsonLine(res, {
							type: "text-delta",
							delta: part.text,
						});
						continue;
					}
					const preview = documentPayloadCollector?.push(part.text);
					if (
						preview?.changed &&
						preview.text.length > lastSentLength
					) {
						const increment = preview.text.slice(lastSentLength);
						lastSentLength = preview.text.length;
						writeJsonLine(res, { type: "phase", phase: "writing" });
						writeJsonLine(res, {
							type: "text-delta",
							delta: increment,
						});
					}
					continue;
				}

				if (part.type === "error") {
					throw part.error;
				}
			}

			if (!shouldStreamRawText) {
				const documentPayload = documentPayloadCollector?.finalize();
				if (documentPayload && !documentPayload.ok) {
					logPlaygroundEvent("ai:document-payload-invalid", {
						requestId,
						sessionId,
						reason: documentPayload.reason,
					});
				}
			}
		}

		metrics.totalServerMs = performance.now() - metrics.startedAt;
		logPlaygroundEvent("ai:request-complete", {
			requestId,
			sessionId,
			mode: requestPlan.mode,
			model: requestPlan.modelId,
			totalServerMs: roundMs(metrics.totalServerMs),
			toolCallCount: metrics.toolCallCount,
			toolExecutionMs: roundMs(metrics.toolExecutionMs),
			firstToolStartMs: roundMs(metrics.firstToolStartMs),
			firstToolResultMs: roundMs(metrics.firstToolResultMs),
			firstTextDeltaServerMs: roundMs(metrics.firstTextDeltaServerMs),
		});
		writeJsonLine(res, {
			type: "metrics",
			requestId,
			sessionId,
			requestMode: metrics.requestMode,
			requestModel: metrics.requestModel,
			contextFormat: metrics.contextFormat,
			firstToolStartMs: metrics.firstToolStartMs,
			firstToolResultMs: metrics.firstToolResultMs,
			firstTextDeltaServerMs: metrics.firstTextDeltaServerMs,
			totalServerMs: metrics.totalServerMs,
			toolCallCount: metrics.toolCallCount,
			toolExecutionMs: metrics.toolExecutionMs,
			contextBytesJson: metrics.contextBytesJson,
			contextEstimatedTokensJson: metrics.contextEstimatedTokensJson,
		});
		writeJsonLine(res, { type: "done" });
		res.end();
	} catch (error) {
		logPlaygroundEvent("ai:request-error", {
			requestId,
			sessionId,
			error: formatError(error),
		});
		if (!res.headersSent) {
			sendJson(res, 500, { error: formatError(error) });
			return;
		}

		writeJsonLine(res, {
			type: "error",
			error: formatError(error),
		});
		res.end();
	} finally {
		session.activeRequestCount = Math.max(
			0,
			session.activeRequestCount - 1,
		);
		touchSession(session);
		logPlaygroundEvent("ai:request-finish", {
			requestId,
			sessionId,
			activeRequestCount: session.activeRequestCount,
		});
	}
}

function handleListToolsRequest(
	req: IncomingMessage,
	res: ServerResponse,
): void {
	const resolved = resolvePlaygroundToolRuntime(req);
	if (!resolved) {
		sendJson(res, 404, {
			error: "No active playground session matched this tool request.",
		});
		return;
	}

	sendJson(res, 200, {
		tools: listAITools(resolved.toolRuntime),
	});
}

function handleListSkillsRequest(
	req: IncomingMessage,
	res: ServerResponse,
): void {
	const resolved = resolvePlaygroundToolRuntime(req);
	if (!resolved) {
		sendJson(res, 404, {
			error: "No active playground session matched this skill request.",
		});
		return;
	}

	const skills = listDefaultAISkills(listAITools(resolved.toolRuntime), {
		autocompleteProviders:
			getAutocompleteController(
				resolved.editor,
			)?.listProviderDescriptors() ?? [],
	});
	sendJson(res, 200, {
		skills: skills.map((skill) => ({
			name: skill.name,
			title: skill.title,
			description: skill.description,
			files: renderSkillFiles(skill),
		})),
	});
}

async function handleDirectToolRequest(
	req: IncomingMessage,
	res: ServerResponse,
	url: URL,
): Promise<void> {
	const resolved = resolvePlaygroundToolRuntime(req);
	if (!resolved) {
		sendJson(res, 404, {
			error: "No active playground session matched this tool request.",
		});
		return;
	}

	const toolName = decodeURIComponent(
		url.pathname.slice(PLAYGROUND_TOOL_ROUTE_PREFIX.length),
	);
	if (!toolName) {
		sendJson(res, 400, { error: "Expected a valid tool name." });
		return;
	}

	const body = (await readJsonBody<ToolExecuteBody>(req)) ?? {};
	const context = new AIToolContextImpl(resolved.editor, "playground", () => {
		/* Native tool endpoint returns final JSON responses only. */
	});

	try {
		const output = await executeAITool(
			resolved.toolRuntime,
			toolName,
			body.input ?? {},
			context,
		);
		sendJson(res, 200, { toolName, output });
	} catch (error) {
		sendJson(res, 400, {
			error: formatError(error),
			toolName,
		});
	}
}

function createPlaygroundEditor(): Editor {
	const editor = createHeadlessEditor({
		preset: defaultPreset({
			deltaStream: false,
			undo: false,
		}),
		schema: createDefaultSchema(),
		documentProfile: "structured",
	});
	ensurePlaygroundExtensionRoot(editor);
	return editor;
}

function createPlaygroundSession(): PlaygroundSession {
	const session: PlaygroundSession = {
		id: randomUUID(),
		editor: createPlaygroundEditor(),
		clientToServerBlockIds: new Map(),
		createdAt: Date.now(),
		lastTouchedAt: Date.now(),
		lastSyncedAt: null,
		syncedRevision: null,
		syncedGeneration: null,
		activeRequestCount: 0,
	};
	sessions.set(session.id, session);
	return session;
}

function ensurePlaygroundExtensionRoot(editor: Editor) {
	return ensureExtensionRoot({
		doc: getYjsDoc(editor),
		namespace: PLAYGROUND_EXTENSION_ROOT_NAMESPACE,
		version: PLAYGROUND_EXTENSION_ROOT_VERSION,
		shape: {
			requestIds: "array",
			diagnostics: "map",
			notes: "text",
		},
	});
}

function recordPlaygroundRequestMetadata(
	session: PlaygroundSession,
	requestId: string,
	requestMode: PlaygroundRequestMode,
): void {
	const root = ensurePlaygroundExtensionRoot(session.editor);
	const requestIds = root.map.get("requestIds");
	const diagnostics = root.map.get("diagnostics");
	if (requestIds instanceof Y.Array) {
		requestIds.push([requestId]);
	}
	if (diagnostics instanceof Y.Map) {
		diagnostics.set("lastRequestMode", requestMode);
		diagnostics.set("lastRequestId", requestId);
		diagnostics.set("lastRequestAt", new Date().toISOString());
	}
}

function recordPlaygroundSessionSync(session: PlaygroundSession): void {
	const root = ensurePlaygroundExtensionRoot(session.editor);
	const diagnostics = root.map.get("diagnostics");
	if (diagnostics instanceof Y.Map) {
		diagnostics.set("lastSyncedRevision", session.syncedRevision);
		diagnostics.set("lastSyncedGeneration", session.syncedGeneration);
		diagnostics.set(
			"lastSyncedAt",
			new Date(session.lastSyncedAt ?? Date.now()).toISOString(),
		);
	}
}

function createSessionDiagnostics(
	session: PlaygroundSession,
): SessionDiagnosticsResponse {
	const yDoc = getYjsDoc(session.editor);
	const extensionRoot = readExtensionRoot({
		doc: yDoc,
		namespace: PLAYGROUND_EXTENSION_ROOT_NAMESPACE,
	});
	const rootMap = extensionRoot?.map;
	const requestIds = rootMap?.get("requestIds");
	const diagnostics = rootMap?.get("diagnostics");
	const requestCount = requestIds instanceof Y.Array ? requestIds.length : 0;
	const lastRequestMode =
		diagnostics instanceof Y.Map
			? diagnostics.get("lastRequestMode")
			: null;
	const lastSyncedRevision =
		diagnostics instanceof Y.Map
			? diagnostics.get("lastSyncedRevision")
			: null;

	return {
		sessionId: session.id,
		headless: true,
		blockCount: session.editor.documentState.blockOrder.length,
		generation: session.editor.documentState.generation,
		plainText: exportPlainText(session.editor),
		stateVector: encodeYjsStateVectorBase64(yDoc),
		extensionRoot: {
			namespace:
				extensionRoot?.namespace ?? PLAYGROUND_EXTENSION_ROOT_NAMESPACE,
			version: extensionRoot?.version ?? 0,
			requestCount,
			lastRequestMode:
				typeof lastRequestMode === "string" ? lastRequestMode : null,
			lastSyncedRevision:
				typeof lastSyncedRevision === "number"
					? lastSyncedRevision
					: null,
		},
	};
}

function touchSession(session: PlaygroundSession): void {
	session.lastTouchedAt = Date.now();
}

function resolvePlaygroundToolRuntime(
	req: IncomingMessage,
): { editor: Editor; toolRuntime: ToolRuntime } | null {
	const sessionId = readHeader(req, SESSION_HEADER);
	const session = sessionId ? (sessions.get(sessionId) ?? null) : null;
	const editor = session?.editor ?? null;
	if (!editor) {
		return null;
	}

	const toolRuntime = getAIToolRuntime(editor);
	if (!toolRuntime) {
		return null;
	}

	return { editor, toolRuntime };
}

function cleanupIdleSessions(): void {
	const now = Date.now();

	for (const session of sessions.values()) {
		if (session.activeRequestCount > 0) {
			continue;
		}

		if (now - session.lastTouchedAt < PLAYGROUND_SESSION_TTL_MS) {
			continue;
		}

		session.editor.destroy();
		sessions.delete(session.id);
		logPlaygroundEvent("session:expired", {
			sessionId: session.id,
		});
	}
}

function buildPlaygroundRequestPlan(
	editor: Editor,
	prompt: string,
	requestedMode: PlaygroundRequestMode | null,
	requestedOperation: ModelRequestedOperation | null,
): PlaygroundRequestPlan {
	return buildTypedSharedPlaygroundRequestPlan(
		editor,
		prompt,
		{
			documentModel: PLAYGROUND_DOCUMENT_MODEL,
			selectionModel: PLAYGROUND_SELECTION_MODEL,
			documentSystemPrompt: PLAYGROUND_DOCUMENT_SYSTEM_PROMPT,
			structuredPlannerSystemPrompt:
				PLAYGROUND_STRUCTURED_PLANNER_SYSTEM_PROMPT,
			selectionFastPathSystemPrompt:
				PLAYGROUND_SELECTION_FAST_PATH_SYSTEM_PROMPT,
			autocompleteSystemPrompt: AUTOCOMPLETE_SYSTEM_PROMPT,
			selectionSourceCharLimit: PLAYGROUND_SELECTION_SOURCE_CHAR_LIMIT,
			selectionStopSentinel: PLAYGROUND_SELECTION_STOP_SENTINEL,
			selectionOutputTokenCap: PLAYGROUND_SELECTION_OUTPUT_TOKEN_CAP,
			autocompleteOutputTokenCap:
				PLAYGROUND_AUTOCOMPLETE_OUTPUT_TOKEN_CAP,
			selectionDefaultOutputTokens:
				PLAYGROUND_SELECTION_DEFAULT_OUTPUT_TOKENS,
			selectionExpandOutputTokens:
				PLAYGROUND_SELECTION_EXPAND_OUTPUT_TOKENS,
			selectionSummarizeOutputTokens:
				PLAYGROUND_SELECTION_SUMMARIZE_OUTPUT_TOKENS,
			selectionTranslateOutputTokens:
				PLAYGROUND_SELECTION_TRANSLATE_OUTPUT_TOKENS,
		},
		requestedMode,
		requestedOperation,
	);
}

function parsePlaygroundRequestMode(
	value: unknown,
): PlaygroundRequestMode | null {
	const requestedMode =
		value === "document-agent" ||
		value === "structured-generation" ||
		value === "selection-fast" ||
		value === "inline-autocomplete" ||
		value === "bottom-chat" ||
		value === "inline-edit" ||
		value === "structured-planner"
			? (value as PlaygroundRequestedMode)
			: null;
	if (!requestedMode) {
		return null;
	}
	if (requestedMode === "bottom-chat") {
		return "document-agent";
	}
	if (requestedMode === "inline-edit") {
		return "selection-fast";
	}
	if (requestedMode === "structured-planner") {
		return "structured-generation";
	}
	return requestedMode;
}

function resolveOperationRequestMode(
	operation: ModelRequestedOperation | null,
	requestedMode: PlaygroundRequestMode | null,
): PlaygroundRequestMode | null {
	if (
		operation?.kind === "rewrite-selection" ||
		operation?.kind === "rewrite-block" ||
		operation?.kind === "continue-block"
	) {
		return "selection-fast";
	}
	if (operation) {
		return requestedMode ?? "document-agent";
	}
	return requestedMode;
}

function parseRequestedOperation(
	value: unknown,
): ModelRequestedOperation | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	const candidate = value as ModelRequestedOperation;
	if (
		candidate.kind !== "rewrite-selection" &&
		candidate.kind !== "rewrite-block" &&
		candidate.kind !== "continue-block" &&
		candidate.kind !== "document-transform"
	) {
		return null;
	}
	if (
		candidate.applyPolicy !== "selection-replace" &&
		candidate.applyPolicy !== "block-replace" &&
		candidate.applyPolicy !== "block-continue" &&
		candidate.applyPolicy !== "document-review"
	) {
		return null;
	}
	if (!candidate.target || typeof candidate.target !== "object") {
		return null;
	}
	if (
		candidate.target.kind === "selection" ||
		candidate.target.kind === "scoped-range"
	) {
		return (candidate.target.blockId == null ||
			typeof candidate.target.blockId === "string") &&
			typeof candidate.target.anchor?.blockId === "string" &&
			typeof candidate.target.anchor?.offset === "number" &&
			typeof candidate.target.focus?.blockId === "string" &&
			typeof candidate.target.focus?.offset === "number" &&
			typeof candidate.target.sourceText === "string" &&
			(candidate.target.kind !== "scoped-range" ||
				(Array.isArray(candidate.target.blockIds) &&
					candidate.target.blockIds.every(
						(blockId) => typeof blockId === "string",
					) &&
					(candidate.target.contentFormat === "text" ||
						candidate.target.contentFormat === "markdown") &&
					(candidate.target.scope === "block" ||
						candidate.target.scope === "paragraph" ||
						candidate.target.scope === "document" ||
						candidate.target.scope === "heading")))
			? candidate
			: null;
	}
	if (candidate.target.kind === "block") {
		return typeof candidate.target.blockId === "string" &&
			typeof candidate.target.sourceText === "string"
			? candidate
			: null;
	}
	if (candidate.target.kind === "document") {
		return (candidate.target.blockIds === undefined ||
			(Array.isArray(candidate.target.blockIds) &&
				candidate.target.blockIds.every(
					(blockId) => typeof blockId === "string",
				))) &&
			(candidate.target.placement === undefined ||
				candidate.target.placement === "append-after-block" ||
				candidate.target.placement === "replace-empty-block" ||
				candidate.target.placement === "replace-blocks") &&
			(candidate.target.transform === undefined ||
				candidate.target.transform === "write" ||
				candidate.target.transform === "rewrite" ||
				candidate.target.transform === "remove")
			? candidate
			: null;
	}
	return null;
}

function parseAISuggestionRequestScope(
	value: unknown,
): AISuggestionRequestScope | null {
	if (!value || typeof value !== "object") {
		return null;
	}

	const candidate = value as Record<string, unknown>;
	return typeof candidate.targetText === "string" &&
		typeof candidate.contextBefore === "string" &&
		typeof candidate.contextAfter === "string" &&
		(candidate.blockType === null ||
			typeof candidate.blockType === "string")
		? {
				blockType: (candidate.blockType as string | null) ?? null,
				targetText: candidate.targetText,
				contextBefore: candidate.contextBefore,
				contextAfter: candidate.contextAfter,
			}
		: null;
}

function resolveUsageTokenValue(
	usage: unknown,
	key: "inputTokens" | "outputTokens",
): number {
	if (!usage || typeof usage !== "object") {
		return 0;
	}

	const value = (usage as Record<string, unknown>)[key];
	return typeof value === "number" ? value : 0;
}

async function streamLocalOperationResponse(input: {
	res: ServerResponse;
	editor: Editor;
	prompt: string;
	operation: ModelRequestedOperation;
	requestedMode: PlaygroundRequestedMode | null;
	requestPlan: PlaygroundRequestPlan;
	abortSignal: AbortSignal;
	metrics: PlaygroundRequestMetrics;
	requestId: string;
	sessionId: string;
}): Promise<void> {
	const {
		res,
		editor,
		prompt,
		operation,
		requestedMode,
		requestPlan,
		abortSignal,
		metrics,
		requestId,
		sessionId,
	} = input;
	const usesClientInlineSelectionPreview = requestedMode === "inline-edit";
	const conflictReason = resolveRequestedOperationConflict(
		editor,
		operation,
		{
			allowSelectionTextMismatch: usesClientInlineSelectionPreview,
		},
	);
	if (conflictReason) {
		writeJsonLine(res, {
			type: "conflict",
			reason: conflictReason,
			operation,
		});
		return;
	}

	const result = streamText({
		model: createPlaygroundLanguageModel(requestPlan.modelId),
		system:
			operation.kind === "continue-block"
				? PLAYGROUND_LOCAL_CONTINUE_SYSTEM_PROMPT
				: PLAYGROUND_LOCAL_REWRITE_SYSTEM_PROMPT,
		prompt: usesClientInlineSelectionPreview
			? buildExplicitLocalOperationPrompt(prompt, operation)
			: requestPlan.prompt,
		...(requestPlan.maxOutputTokens != null
			? { maxOutputTokens: requestPlan.maxOutputTokens }
			: {}),
		...(requestPlan.temperature != null
			? { temperature: requestPlan.temperature }
			: {}),
		...(requestPlan.stopSequences
			? { stopSequences: requestPlan.stopSequences }
			: {}),
		abortSignal,
	});

	const payloadCollector = createLocalOperationPayloadCollector();
	for await (const part of result.fullStream) {
		if (part.type === "text-delta") {
			if (metrics.firstTextDeltaServerMs == null) {
				metrics.firstTextDeltaServerMs =
					performance.now() - metrics.startedAt;
				logPlaygroundEvent("ai:first-text-delta", {
					requestId,
					sessionId,
					elapsedMs: roundMs(metrics.firstTextDeltaServerMs),
				});
			}
			const preview = payloadCollector.push(part.text);
			if (preview.changed && preview.text.length > 0) {
				writeJsonLine(res, { type: "phase", phase: "writing" });
				writeJsonLine(res, {
					type: resolveLocalOperationFrameType(operation, "preview"),
					text: preview.text,
					operation,
				});
			}
			continue;
		}
		if (part.type === "error") {
			throw part.error;
		}
	}

	const payload = payloadCollector.finalize();
	if (!payload.ok) {
		throw new Error(payload.reason);
	}

	writeJsonLine(res, {
		type: resolveLocalOperationFrameType(operation, "final"),
		text: payload.text,
		operation,
	});
}

function resolveLocalOperationFrameType(
	operation: ModelRequestedOperation,
	phase: "preview" | "final",
): "replace-preview" | "replace-final" | "insert-preview" | "insert-final" {
	if (
		operation.kind === "continue-block" ||
		(operation.kind === "document-transform" &&
			operation.target.kind === "document" &&
			operation.target.placement === "append-after-block")
	) {
		return phase === "preview" ? "insert-preview" : "insert-final";
	}
	return phase === "preview" ? "replace-preview" : "replace-final";
}

function resolveDocumentTransformTargetBlockIds(
	editor: Editor,
	target: Extract<ModelRequestedOperation["target"], { kind: "document" }>,
): string[] {
	const requestedBlockIds =
		target.blockIds?.filter(
			(blockId) => editor.getBlock(blockId) != null,
		) ?? [];
	if (requestedBlockIds.length > 0) {
		return requestedBlockIds;
	}
	if (target.activeBlockId && editor.getBlock(target.activeBlockId)) {
		return [target.activeBlockId];
	}
	return editor.documentState.blockOrder.filter(
		(blockId) => editor.getBlock(blockId) != null,
	);
}

function remapRequestedOperationBlockIds(
	operation: ModelRequestedOperation,
	clientToServerBlockIds: ReadonlyMap<string, string>,
): ModelRequestedOperation {
	const remapBlockId = (blockId: string | null | undefined): string | null =>
		blockId == null
			? null
			: (clientToServerBlockIds.get(blockId) ?? blockId);
	if (
		operation.target.kind === "selection" ||
		operation.target.kind === "scoped-range"
	) {
		return {
			...operation,
			target: {
				...operation.target,
				blockId: remapBlockId(operation.target.blockId),
				...(operation.target.kind === "scoped-range"
					? {
							blockIds: operation.target.blockIds.map(
								(blockId) =>
									clientToServerBlockIds.get(blockId) ??
									blockId,
							),
						}
					: {}),
				anchor: {
					...operation.target.anchor,
					blockId:
						clientToServerBlockIds.get(
							operation.target.anchor.blockId,
						) ?? operation.target.anchor.blockId,
				},
				focus: {
					...operation.target.focus,
					blockId:
						clientToServerBlockIds.get(
							operation.target.focus.blockId,
						) ?? operation.target.focus.blockId,
				},
			},
		};
	}
	if (operation.target.kind === "block") {
		return {
			...operation,
			target: {
				...operation.target,
				blockId:
					clientToServerBlockIds.get(operation.target.blockId) ??
					operation.target.blockId,
			},
		};
	}
	return {
		...operation,
		target: {
			...operation.target,
			activeBlockId: remapBlockId(operation.target.activeBlockId),
			blockIds: operation.target.blockIds?.map(
				(blockId) => clientToServerBlockIds.get(blockId) ?? blockId,
			),
		},
	};
}

function resolveRequestedOperationConflict(
	editor: Editor,
	operation: ModelRequestedOperation,
	options?: {
		allowSelectionTextMismatch?: boolean;
	},
): string | null {
	if (
		operation.target.kind === "selection" ||
		operation.target.kind === "scoped-range"
	) {
		const target = operation.target;
		const targetBlockIds = resolveSelectionTargetBlockIds(editor, target);
		if (targetBlockIds.length === 0) {
			return "The selected range no longer exists.";
		}
		if (
			isScopedSelectionTarget(target) &&
			operation.provenance?.syncedGeneration != null &&
			operation.provenance.syncedGeneration >= 0 &&
			editor.documentState.generation !==
				operation.provenance.syncedGeneration
		) {
			return "The document changed before the operation started.";
		}
		const currentText = renderSelectionTargetText(editor, target, {
			resolved: true,
		});
		if (options?.allowSelectionTextMismatch) {
			return null;
		}
		if (currentText === operation.target.sourceText) {
			return null;
		}
		return "The selected text changed before the operation started.";
	}
	if (operation.target.kind === "block") {
		const block = editor.getBlock(operation.target.blockId);
		if (!block) {
			return "The target block no longer exists.";
		}
		if (
			operation.provenance?.blockRevision != null &&
			editor.getBlockRevision(operation.target.blockId) !==
				operation.provenance.blockRevision
		) {
			return "The target block changed before the operation started.";
		}
	}
	if (
		operation.target.kind === "document" &&
		operation.provenance?.syncedGeneration != null &&
		operation.provenance.syncedGeneration >= 0 &&
		editor.documentState.generation !==
			operation.provenance.syncedGeneration
	) {
		return "The document changed before the operation started.";
	}
	return null;
}

function buildPromptContext(editor: Editor): PromptContextEnvelope {
	return buildSharedPromptContext(editor);
}

function buildPlaygroundTools(
	editor: Editor,
	metrics: PlaygroundRequestMetrics,
): Record<string, ReturnType<typeof tool>> {
	const toolRuntime = getAIToolRuntime(editor);
	if (!toolRuntime) {
		return {};
	}

	const context = new AIToolContextImpl(editor, "playground", () => {
		/* Server-side tool execution streams metrics, not editor deltas */
	});

	return toolRuntime
		.listTools()
		.reduce<
			Record<string, ReturnType<typeof tool>>
		>((accumulator, definition) => {
			if (!PLAYGROUND_DIRECT_TOOL_NAMES.has(definition.name)) {
				return accumulator;
			}

			accumulator[definition.name] = {
				description: definition.description,
				inputSchema: jsonSchema(
					definition.inputSchema as Record<string, unknown>,
				),
				execute: async (input: unknown) => {
					const startedAt = performance.now();
					const result = await executeAITool(
						toolRuntime,
						definition.name,
						input,
						context,
					);
					metrics.toolExecutionMs += performance.now() - startedAt;
					if (metrics.firstToolResultMs == null) {
						metrics.firstToolResultMs =
							performance.now() - metrics.startedAt;
					}
					return result;
				},
			} as unknown as ReturnType<typeof tool>;
			return accumulator;
		}, {});
}

function hydrateEditor(
	editor: Editor,
	state: SerializedEditorState,
): Map<string, string> {
	const firstSerializedBlock = state.blocks[0];
	const firstEditorBlock = editor.firstBlock();
	const idMap = new Map<string, string>();

	if (firstSerializedBlock && firstEditorBlock) {
		idMap.set(firstSerializedBlock.id, firstEditorBlock.id);
		applyBlockSnapshot(
			editor,
			firstSerializedBlock,
			firstEditorBlock.id,
			idMap,
		);
	}

	for (const block of state.blocks.slice(1)) {
		insertBlockSnapshot(editor, block, idMap);
	}

	restoreSelection(editor, state.selection, idMap);
	return idMap;
}

function insertBlockSnapshot(
	editor: Editor,
	block: SerializedBlock,
	idMap: Map<string, string>,
): void {
	editor.apply([
		{
			type: "insert-block",
			blockId: block.id,
			blockType: block.type,
			props: block.props,
			position: "last",
		},
	]);

	idMap.set(block.id, block.id);
	applyBlockSnapshot(editor, block, block.id, idMap);
}

function applyBlockSnapshot(
	editor: Editor,
	block: SerializedBlock,
	targetBlockId: string,
	idMap: Map<string, string>,
): void {
	editor.apply([
		{
			type: "convert-block",
			blockId: targetBlockId,
			newType: block.type,
			newProps: normalizeBlockProps(block.props, idMap),
		},
	]);

	if (block.text) {
		editor.apply([
			{
				type: "insert-text",
				blockId: targetBlockId,
				offset: 0,
				text: block.text,
			},
		]);
	}

	applyTableSnapshot(editor, targetBlockId, block);

	const childBlocks = block.children ?? [];
	for (const child of childBlocks) {
		editor.apply([
			{
				type: "insert-block",
				blockId: child.id,
				blockType: child.type,
				props: {
					...normalizeBlockProps(child.props, idMap),
					parentId: targetBlockId,
				},
				position: "last",
			},
		]);

		idMap.set(child.id, child.id);
		applyBlockSnapshot(editor, child, child.id, idMap);
	}
}

function applyTableSnapshot(
	editor: Editor,
	blockId: string,
	block: SerializedBlock,
): void {
	if (!block.table) {
		return;
	}
	const currentBlock = editor.getBlock(blockId);
	const ops = buildTableSnapshotOps(blockId, block.table, {
		rowCount: currentBlock?.tableRowCount() ?? 0,
		columnCount: currentBlock?.tableColumnCount() ?? 0,
	});
	if (ops.length > 0) {
		editor.apply(ops);
	}
}

function restoreSelection(
	editor: Editor,
	selection: SerializedSelection,
	idMap: Map<string, string>,
): void {
	if (!selection) {
		return;
	}

	if (selection.type === "text") {
		const blockId = idMap.get(selection.blockId) ?? selection.blockId;
		editor.selectTextRange(
			{ blockId, offset: selection.anchor },
			{ blockId, offset: selection.focus },
		);
		return;
	}

	if (selection.type === "block") {
		editor.selectBlocks(
			selection.blockIds.map((blockId) => idMap.get(blockId) ?? blockId),
		);
		return;
	}

	if (selection.type === "cell") {
		const blockId = idMap.get(selection.blockId) ?? selection.blockId;
		editor.selectCellRange(blockId, selection.anchor, selection.head);
	}
}

function normalizeBlockProps(
	props: Record<string, unknown>,
	idMap: Map<string, string>,
): Record<string, unknown> {
	const normalizedParentId =
		typeof props.parentId === "string"
			? (idMap.get(props.parentId) ?? props.parentId)
			: props.parentId;

	return {
		...props,
		...(normalizedParentId ? { parentId: normalizedParentId } : {}),
	};
}

function readHeader(req: IncomingMessage, key: string): string | null {
	const value = req.headers[key];
	if (Array.isArray(value)) {
		return value[0] ?? null;
	}

	return value ?? null;
}

async function readJsonBody<T = unknown>(
	req: IncomingMessage,
): Promise<T | undefined> {
	const chunks: Uint8Array[] = [];

	for await (const chunk of req) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
	}

	if (chunks.length === 0) {
		return undefined;
	}

	const body = Buffer.concat(chunks).toString("utf8").trim();
	return body ? (JSON.parse(body) as T) : undefined;
}

function sendJson(
	res: ServerResponse,
	statusCode: number,
	body: Record<string, unknown>,
): void {
	res.writeHead(statusCode, {
		"content-type": "application/json; charset=utf-8",
	});
	res.end(JSON.stringify(body));
}

function writeJsonLine(
	res: ServerResponse,
	payload: Record<string, unknown>,
): void {
	res.write(`${JSON.stringify(payload)}\n`);
}

function formatError(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	return typeof error === "string" ? error : "Unknown error";
}

function truncateText(value: string, limit: number): string {
	if (value.length <= limit) {
		return value;
	}

	return `${value.slice(0, limit)}...`;
}

function createPlaygroundLanguageModel(modelId: string) {
	return anthropic(modelId as Parameters<typeof anthropic>[0]);
}

function roundMs(value: number | null): number | null {
	if (value == null || !Number.isFinite(value)) {
		return null;
	}

	return Math.round(value * 100) / 100;
}

function normalizePlaygroundModelName(modelName: string | undefined): string {
	if (!modelName) {
		return "claude-sonnet-4-5";
	}

	return modelName
		.trim()
		.replace(/^claude-3-haiku$/i, "claude-3-haiku-20240307")
		.replace(/^claude-sonnet-4\.5$/i, "claude-sonnet-4-5")
		.replace(/^claude-sonnet-4\.6$/i, "claude-sonnet-4-6");
}

function normalizePlaygroundSelectionModelName(
	modelName: string | undefined,
): string {
	if (!modelName) {
		return "claude-haiku-4-5";
	}

	return normalizePlaygroundModelName(modelName);
}

function logPlaygroundEvent(
	event: string,
	payload: Record<string, unknown>,
): void {
	if (!PLAYGROUND_DEBUG_LOGS) {
		return;
	}

	const timestamp = new Date().toISOString();
	console.log(`[playground-ai] ${timestamp} ${event}`, payload);
}

function handleCollaborationUpgrade(
	request: IncomingMessage,
	socket: Duplex,
	head: Buffer,
): void {
	const requestUrl = new URL(
		request.url ?? PLAYGROUND_COLLAB_ROUTE_PREFIX,
		`ws://${request.headers.host ?? `${PLAYGROUND_SERVER_HOST}:${PLAYGROUND_SERVER_PORT}`}`,
	);
	if (!requestUrl.pathname.startsWith(PLAYGROUND_COLLAB_ROUTE_PREFIX)) {
		socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
		socket.destroy();
		return;
	}

	collaborationWebSocketServer.handleUpgrade(
		request,
		socket,
		head,
		(ws: WebSocket) => {
			collaborationWebSocketServer.emit("connection", ws, request);
		},
	);
}

function resolveCollaborationDocName(request: IncomingMessage): string {
	const requestUrl = new URL(
		request.url ?? PLAYGROUND_COLLAB_ROUTE_PREFIX,
		`ws://${request.headers.host ?? `${PLAYGROUND_SERVER_HOST}:${PLAYGROUND_SERVER_PORT}`}`,
	);
	const roomPath = requestUrl.pathname
		.slice(PLAYGROUND_COLLAB_ROUTE_PREFIX.length)
		.replace(/^\/+/, "");
	return roomPath || PLAYGROUND_COLLAB_DEFAULT_DOC_NAME;
}

function shutdownPlaygroundServer(signal: NodeJS.Signals): void {
	if (isShuttingDown) {
		return;
	}

	isShuttingDown = true;
	logPlaygroundEvent("server:shutdown", { signal });

	const exitTimer = setTimeout(() => {
		process.exit();
	}, 5_000);
	exitTimer.unref?.();

	server.close((error) => {
		collaborationWebSocketServer.close();
		clearTimeout(exitTimer);
		if (error) {
			console.error(
				"Failed to close playground AI backend cleanly:",
				error,
			);
			process.exit(1);
			return;
		}

		process.exit();
	});
}
