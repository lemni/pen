import { anthropic } from "@ai-sdk/anthropic";
import { jsonSchema, Output, stepCountIs, streamText, tool } from "ai";
import { config as loadEnv } from "dotenv";
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";
import {
	createEditor,
} from "../../packages/core/src/index";
import type {
	Editor,
	TableColumnSchema,
	ToolRuntime,
} from "../../packages/types/src/index";
import {
	buildPlaygroundRequestPlan as buildSharedPlaygroundRequestPlan,
	buildPromptContext as buildSharedPromptContext,
	createPlaygroundRequestMetricsSeed,
} from "../../packages/extensions/ai/src/runtime/playgroundPlanner";
import {
	buildStructuredIntentModelPrompt,
	getStructuredIntentOutputSchema,
	parseStructuredIntentRequestPrompt,
} from "../../packages/extensions/ai/src/runtime/structuredIntent";
import {
	AIToolContextImpl,
	executeAITool,
	getAIToolRuntime,
	listAITools,
} from "../../packages/extensions/ai-tools/src/index";
import {
	listDefaultAISkills,
	renderSkillFiles,
} from "../../packages/extensions/ai-skills/src/index";
import { getAutocompleteController } from "../../packages/extensions/ai-autocomplete/src/index";
import { AUTOCOMPLETE_SYSTEM_PROMPT } from "../../packages/extensions/ai-autocomplete/src/promptBuilder";
import { createDefaultSchema } from "../../packages/schema/default/src/index";
import { defaultPreset } from "../../packages/presets/default/src/index";

loadEnv({
	path: fileURLToPath(new URL("../.env.local", import.meta.url)),
});

const PLAYGROUND_SERVER_HOST = process.env.PLAYGROUND_AI_HOST ?? "127.0.0.1";
const PLAYGROUND_SERVER_PORT = Number(process.env.PLAYGROUND_AI_PORT ?? "8787");
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
	"Use the inline document context first, and call tools only when you need more precision or broader context. " +
	"When producing document text, return only the text to insert into the editor. " +
	'Do not add assistant framing such as "Here is", "Here\'s", or "I wrote".';
const PLAYGROUND_STRUCTURED_PLANNER_SYSTEM_PROMPT =
	"You are the structured intent generator for the Pen playground. " +
	"Return exactly one valid Pen structured intent object as JSON. " +
	"Do not include markdown fences, explanatory prose, or conversational text.";
const SESSION_HEADER = "x-pen-playground-session";
const PLAYGROUND_SESSION_TTL_MS = 15 * 60 * 1000;
const PLAYGROUND_SESSION_CLEANUP_INTERVAL_MS = 60 * 1000;
const PLAYGROUND_MAX_TOOL_STEPS = 4;
const PLAYGROUND_DEBUG_LOGS = process.env.PLAYGROUND_AI_DEBUG !== "false";
const PLAYGROUND_SELECTION_SOURCE_CHAR_LIMIT = 12_000;
const PLAYGROUND_SELECTION_OUTPUT_TOKEN_CAP = 1_200;
const PLAYGROUND_SELECTION_DEFAULT_OUTPUT_TOKENS = 128;
const PLAYGROUND_SELECTION_EXPAND_OUTPUT_TOKENS = 640;
const PLAYGROUND_SELECTION_SUMMARIZE_OUTPUT_TOKENS = 160;
const PLAYGROUND_SELECTION_TRANSLATE_OUTPUT_TOKENS = 480;
const PLAYGROUND_SELECTION_STOP_SENTINEL = "<pen:end>";
const PLAYGROUND_SKILLS_ROUTE = "/api/skills";
const PLAYGROUND_TOOL_ROUTE_PREFIX = "/api/tools/";
const PLAYGROUND_DIRECT_TOOL_NAMES = new Set([
	"get_context",
	"read_document",
	"search_document",
	"list_block_types",
]);

interface SerializedTableCell {
	id: string;
	row: number;
	col: number;
	text: string;
}

interface SerializedTableRow {
	id: string;
	index: number;
	cells: SerializedTableCell[];
}

interface SerializedTableColumn extends TableColumnSchema {
	[key: string]: unknown;
}

interface SerializedTableContent {
	columnCount: number;
	rowCount: number;
	columns: readonly SerializedTableColumn[];
	rows: SerializedTableRow[];
}

interface SerializedBlock {
	id: string;
	type: string;
	props: Record<string, unknown>;
	text: string;
	children?: SerializedBlock[];
	table?: SerializedTableContent;
}

type SerializedSelection =
	| {
		type: "text";
		blockId: string;
		anchor: number;
		focus: number;
		collapsed: boolean;
		isMultiBlock: boolean;
	}
	| {
		type: "block";
		blockIds: string[];
	}
	| {
		type: "cell";
		blockId: string;
		anchor: { row: number; col: number };
		head: { row: number; col: number };
	}
	| {
		type: "app";
		appId: string;
	}
	| null;

interface SerializedEditorState {
	blockCount: number;
	selection: SerializedSelection;
	fieldEditor: unknown;
	blocks: SerializedBlock[];
}

interface AIRequestBody {
	prompt?: unknown;
	sessionId?: unknown;
	contextFormat?: unknown;
}

interface ToolExecuteBody {
	input?: unknown;
}

interface SessionCreateResponse {
	sessionId: string;
}

interface SessionSyncBody {
	sessionId?: unknown;
	editorState?: unknown;
}

interface PlaygroundSession {
	id: string;
	editor: Editor;
	createdAt: number;
	lastTouchedAt: number;
	lastSyncedAt: number | null;
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

type PlaygroundRequestMode =
	| "document-agent"
	| "structured-planner"
	| "selection-fast"
	| "inline-autocomplete";
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

const sessions = new Map<string, PlaygroundSession>();
const serverOrigin = `http://${PLAYGROUND_SERVER_HOST}:${PLAYGROUND_SERVER_PORT}`;
const sessionCleanupTimer = setInterval(
	cleanupIdleSessions,
	PLAYGROUND_SESSION_CLEANUP_INTERVAL_MS,
);
sessionCleanupTimer.unref?.();

const server = createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? "/", serverOrigin);

		if (url.pathname === "/health") {
			sendJson(res, 200, { ok: true });
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

		if (url.pathname === "/api/tools" && req.method === "GET") {
			handleListToolsRequest(req, res);
			return;
		}

		if (url.pathname === PLAYGROUND_SKILLS_ROUTE && req.method === "GET") {
			handleListSkillsRequest(req, res);
			return;
		}

		if (url.pathname.startsWith(PLAYGROUND_TOOL_ROUTE_PREFIX) && req.method === "POST") {
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

server.listen(PLAYGROUND_SERVER_PORT, PLAYGROUND_SERVER_HOST, () => {
	console.log(
		`Pen playground AI backend listening on ${serverOrigin}`,
	);
});

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
	sendJson(res, 200, { sessionId: session.id } satisfies SessionCreateResponse);
}

async function handleSessionSync(
	req: IncomingMessage,
	res: ServerResponse,
): Promise<void> {
	const body = (await readJsonBody<SessionSyncBody>(req)) ?? {};
	const sessionId =
		typeof body.sessionId === "string" ? body.sessionId : null;
	const editorState = isSerializedEditorState(body.editorState)
		? body.editorState
		: null;

	if (!sessionId) {
		logPlaygroundEvent("session:sync-rejected", {
			reason: "missing-session-id",
		});
		sendJson(res, 400, { error: "Expected a valid playground session ID." });
		return;
	}

	if (!editorState) {
		logPlaygroundEvent("session:sync-rejected", {
			sessionId,
			reason: "missing-editor-state",
		});
		sendJson(res, 400, { error: "Expected a serialized editor state payload." });
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
	hydrateEditor(nextEditor, editorState);

	const previousEditor = session.editor;
	session.editor = nextEditor;
	session.lastSyncedAt = Date.now();
	touchSession(session);
	previousEditor.destroy();
	logPlaygroundEvent("session:sync-complete", {
		sessionId: session.id,
		blockCount: editorState.blockCount,
	});

	sendJson(res, 200, {
		sessionId: session.id,
		lastSyncedAt: session.lastSyncedAt,
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
			error:
				"Missing ANTHROPIC_API_KEY. Add it to playground/.env.local before starting the backend.",
		});
		return;
	}

	const body = (await readJsonBody<AIRequestBody>(req)) ?? {};
	const prompt =
		typeof body.prompt === "string" ? body.prompt.trim() : "";
	const sessionId =
		typeof body.sessionId === "string" ? body.sessionId : null;

	if (!prompt) {
		logPlaygroundEvent("ai:request-rejected", {
			reason: "empty-prompt",
		});
		sendJson(res, 400, { error: "Expected a non-empty prompt." });
		return;
	}

	if (!sessionId) {
		logPlaygroundEvent("ai:request-rejected", {
			reason: "missing-session-id",
		});
		sendJson(res, 400, { error: "Expected a valid playground session ID." });
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

	session.activeRequestCount += 1;
	touchSession(session);
	const abortController = new AbortController();
	const requestId = randomUUID();
	const requestPlan = buildPlaygroundRequestPlan(
		session.editor,
		prompt,
	);
	const structuredIntentRequest = parseStructuredIntentRequestPrompt(prompt);
	const metrics: PlaygroundRequestMetrics = {
		requestId,
		sessionId,
		startedAt: performance.now(),
		...createPlaygroundRequestMetricsSeed(requestPlan),
	};

	req.on("close", () => {
		abortController.abort();
		logPlaygroundEvent("ai:request-abort-signal", {
			requestId,
			sessionId,
		});
	});

	try {
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

		if (structuredIntentRequest) {
			const structuredChunkTypePrefix =
				structuredIntentRequest.targetKind === "table" ? "grid" : "app";
			const result = streamText({
				model: createPlaygroundLanguageModel(requestPlan.modelId),
				system: requestPlan.systemPrompt,
				prompt: buildStructuredIntentModelPrompt(structuredIntentRequest),
				output: Output.object({
					schema: jsonSchema(
						getStructuredIntentOutputSchema(structuredIntentRequest.targetKind),
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
					metrics.firstTextDeltaServerMs = performance.now() - metrics.startedAt;
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
						tools: buildPlaygroundTools(session.editor, metrics),
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

			for await (const part of result.fullStream) {
				if (part.type === "tool-call") {
					if (metrics.firstToolStartMs == null) {
						metrics.firstToolStartMs = performance.now() - metrics.startedAt;
						logPlaygroundEvent("ai:first-tool-call", {
							requestId,
							sessionId,
							toolName: part.toolName,
							elapsedMs: roundMs(metrics.firstToolStartMs),
						});
					}
					metrics.toolCallCount += 1;
					writeJsonLine(res, { type: "phase", phase: "tool-calling" });
					continue;
				}

				if (part.type === "text-delta") {
					if (metrics.firstTextDeltaServerMs == null) {
						metrics.firstTextDeltaServerMs = performance.now() - metrics.startedAt;
						logPlaygroundEvent("ai:first-text-delta", {
							requestId,
							sessionId,
							elapsedMs: roundMs(metrics.firstTextDeltaServerMs),
						});
					}
					writeJsonLine(res, { type: "phase", phase: "writing" });
					writeJsonLine(res, {
						type: "text-delta",
						delta: part.text,
					});
					continue;
				}

				if (part.type === "error") {
					throw part.error;
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
		session.activeRequestCount = Math.max(0, session.activeRequestCount - 1);
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
			getAutocompleteController(resolved.editor)?.listProviderDescriptors() ?? [],
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
	return createEditor({
		preset: defaultPreset({
			deltaStream: false,
			undo: false,
		}),
		schema: createDefaultSchema(),
		documentProfile: "structured",
	});
}

function createPlaygroundSession(): PlaygroundSession {
	const session: PlaygroundSession = {
		id: randomUUID(),
		editor: createPlaygroundEditor(),
		createdAt: Date.now(),
		lastTouchedAt: Date.now(),
		lastSyncedAt: null,
		activeRequestCount: 0,
	};
	sessions.set(session.id, session);
	return session;
}

function touchSession(session: PlaygroundSession): void {
	session.lastTouchedAt = Date.now();
}

function resolvePlaygroundToolRuntime(
	req: IncomingMessage,
): { editor: Editor; toolRuntime: ToolRuntime } | null {
	const sessionId = readHeader(req, SESSION_HEADER);
	const session = sessionId ? sessions.get(sessionId) ?? null : null;
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
): PlaygroundRequestPlan {
	return buildSharedPlaygroundRequestPlan(editor, prompt, {
		documentModel: PLAYGROUND_DOCUMENT_MODEL,
		selectionModel: PLAYGROUND_SELECTION_MODEL,
		documentSystemPrompt: PLAYGROUND_DOCUMENT_SYSTEM_PROMPT,
		structuredPlannerSystemPrompt: PLAYGROUND_STRUCTURED_PLANNER_SYSTEM_PROMPT,
		selectionFastPathSystemPrompt: PLAYGROUND_SELECTION_FAST_PATH_SYSTEM_PROMPT,
		autocompleteSystemPrompt: AUTOCOMPLETE_SYSTEM_PROMPT,
		selectionSourceCharLimit: PLAYGROUND_SELECTION_SOURCE_CHAR_LIMIT,
		selectionStopSentinel: PLAYGROUND_SELECTION_STOP_SENTINEL,
		selectionOutputTokenCap: PLAYGROUND_SELECTION_OUTPUT_TOKEN_CAP,
		autocompleteOutputTokenCap: PLAYGROUND_AUTOCOMPLETE_OUTPUT_TOKEN_CAP,
		selectionDefaultOutputTokens: PLAYGROUND_SELECTION_DEFAULT_OUTPUT_TOKENS,
		selectionExpandOutputTokens: PLAYGROUND_SELECTION_EXPAND_OUTPUT_TOKENS,
		selectionSummarizeOutputTokens: PLAYGROUND_SELECTION_SUMMARIZE_OUTPUT_TOKENS,
		selectionTranslateOutputTokens: PLAYGROUND_SELECTION_TRANSLATE_OUTPUT_TOKENS,
	});
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

	return toolRuntime.listTools().reduce<Record<string, ReturnType<typeof tool>>>(
		(accumulator, definition) => {
			if (!PLAYGROUND_DIRECT_TOOL_NAMES.has(definition.name)) {
				return accumulator;
			}

			accumulator[definition.name] = {
				description: definition.description,
				inputSchema: jsonSchema(definition.inputSchema as Record<string, unknown>),
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
						metrics.firstToolResultMs = performance.now() - metrics.startedAt;
					}
					return result;
				},
			} as unknown as ReturnType<typeof tool>;
			return accumulator;
		},
		{},
	);
}

function hydrateEditor(editor: Editor, state: SerializedEditorState): void {
	const firstSerializedBlock = state.blocks[0];
	const firstEditorBlock = editor.firstBlock();
	const idMap = new Map<string, string>();

	if (firstSerializedBlock && firstEditorBlock) {
		idMap.set(firstSerializedBlock.id, firstEditorBlock.id);
		applyBlockSnapshot(editor, firstSerializedBlock, firstEditorBlock.id, idMap);
	}

	for (const block of state.blocks.slice(1)) {
		insertBlockSnapshot(editor, block, idMap);
	}

	restoreSelection(editor, state.selection, idMap);
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

	if (block.table.columns.length > 0) {
		editor.apply([
			{
				type: "update-table-columns",
				blockId,
				columns: [...block.table.columns],
			},
		]);
	}

	for (let index = 0; index < block.table.rowCount; index += 1) {
		editor.apply([
			{
				type: "insert-table-row",
				blockId,
				index,
			},
		]);
	}

	for (
		let index = block.table.columns.length;
		index < block.table.columnCount;
		index += 1
	) {
		editor.apply([
			{
				type: "insert-table-column",
				blockId,
				index,
			},
		]);
	}

	for (const row of block.table.rows) {
		for (const cell of row.cells) {
			if (!cell.text) {
				continue;
			}

			editor.apply([
				{
					type: "insert-table-cell-text",
					blockId,
					row: cell.row,
					col: cell.col,
					offset: 0,
					text: cell.text,
				},
			]);
		}
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
			? idMap.get(props.parentId) ?? props.parentId
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
		chunks.push(
			typeof chunk === "string" ? Buffer.from(chunk) : chunk,
		);
	}

	if (chunks.length === 0) {
		return undefined;
	}

	const body = Buffer.concat(chunks).toString("utf8").trim();
	return body ? (JSON.parse(body) as T) : undefined;
}

function isSerializedEditorState(value: unknown): value is SerializedEditorState {
	if (!value || typeof value !== "object") {
		return false;
	}

	const candidate = value as Partial<SerializedEditorState>;
	return Array.isArray(candidate.blocks);
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
		return "claude-3-haiku-20240307";
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
		clearTimeout(exitTimer);
		if (error) {
			console.error("Failed to close playground AI backend cleanly:", error);
			process.exit(1);
			return;
		}

		process.exit();
	});
}
