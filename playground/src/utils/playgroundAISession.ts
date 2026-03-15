import type { Editor } from "@pen/types";
import {
	PLAYGROUND_AI_ENDPOINT,
	PLAYGROUND_AI_SESSION_ENDPOINT,
	PLAYGROUND_AI_SESSION_SYNC_ENDPOINT,
	PLAYGROUND_AI_SYNC_DEBOUNCE_MS,
} from "../constants/playgroundAI";
import { logAutocompleteDebug } from "./autocompleteDebug";
import { serializeEditorState } from "./editorState";

export type PlaygroundAIPhase =
	| "idle"
	| "creating-session"
	| "syncing"
	| "thinking"
	| "tool-calling"
	| "writing"
	| "complete"
	| "error";

export interface PlaygroundAIRequestMetrics {
	requestId: string | null;
	sessionId: string | null;
	requestMode: string | null;
	requestModel: string | null;
	contextFormat: string | null;
	firstToolStartMs: number | null;
	firstToolResultMs: number | null;
	firstTextDeltaServerMs: number | null;
	firstTextDeltaBrowserMs: number | null;
	totalServerMs: number | null;
	totalBrowserMs: number | null;
	toolCallCount: number;
	toolExecutionMs: number | null;
	contextBytesJson: number | null;
	contextEstimatedTokensJson: number | null;
}

export interface PlaygroundAIClientState {
	sessionId: string | null;
	phase: PlaygroundAIPhase;
	syncStatus: "idle" | "syncing" | "error";
	lastSyncMs: number | null;
	lastSyncAt: number | null;
	hasPendingSync: boolean;
	lastRequest: PlaygroundAIRequestMetrics | null;
	lastError: string | null;
}

export interface PlaygroundStreamChunk {
	type?: unknown;
	delta?: unknown;
	data?: unknown;
	error?: unknown;
	requestId?: unknown;
	sessionId?: unknown;
	requestMode?: unknown;
	requestModel?: unknown;
	contextFormat?: unknown;
	phase?: unknown;
	firstToolStartMs?: unknown;
	firstToolResultMs?: unknown;
	firstTextDeltaServerMs?: unknown;
	totalServerMs?: unknown;
	toolCallCount?: unknown;
	toolExecutionMs?: unknown;
	contextBytesJson?: unknown;
	contextEstimatedTokensJson?: unknown;
}

const PLAYGROUND_AI_ACTIVE_SYNC_CONFLICT =
	"Cannot sync a playground session while an AI request is active.";
const PLAYGROUND_AI_ACTIVE_REQUEST_CONFLICT =
	"This playground session already has an active AI request.";

const INITIAL_STATE: PlaygroundAIClientState = {
	sessionId: null,
	phase: "idle",
	syncStatus: "idle",
	lastSyncMs: null,
	lastSyncAt: null,
	hasPendingSync: false,
	lastRequest: null,
	lastError: null,
};

let state = INITIAL_STATE;
const subscribers = new Set<() => void>();
let pendingSyncTimer: number | null = null;
let pendingSyncPromise: Promise<void> | null = null;
let pendingSessionPromise: Promise<string> | null = null;
let activeRequestCount = 0;
let pendingSyncEditor: Editor | null = null;
let pendingSyncReason = "background";
let latestRequestStartedAt = 0;
const editorSyncState = new WeakMap<
	Editor,
	{ revision: number; syncedRevision: number }
>();

export function subscribeToPlaygroundAIState(callback: () => void): () => void {
	subscribers.add(callback);
	return () => {
		subscribers.delete(callback);
	};
}

export function getPlaygroundAIStateSnapshot(): PlaygroundAIClientState {
	return state;
}

export async function ensurePlaygroundAISession(
	signal?: AbortSignal,
): Promise<string> {
	if (state.sessionId) {
		return state.sessionId;
	}
	if (pendingSessionPromise) {
		return pendingSessionPromise;
	}

	pendingSessionPromise = createPlaygroundAISession(signal, {
		persistToState: true,
	}).finally(() => {
		pendingSessionPromise = null;
	});

	return pendingSessionPromise;
}

export function queuePlaygroundAISessionSync(editor: Editor, reason = "background"): void {
	const syncState = getEditorSyncState(editor);
	syncState.revision += 1;
	pendingSyncEditor = editor;
	pendingSyncReason = reason;
	updateState({ hasPendingSync: syncState.revision > syncState.syncedRevision });

	if (activeRequestCount > 0) {
		return;
	}

	if (pendingSyncTimer != null) {
		window.clearTimeout(pendingSyncTimer);
	}

	pendingSyncTimer = window.setTimeout(() => {
		pendingSyncTimer = null;
		if (!pendingSyncEditor) {
			return;
		}
		void flushPlaygroundAISessionSync(pendingSyncEditor, pendingSyncReason);
	}, PLAYGROUND_AI_SYNC_DEBOUNCE_MS);
}

export async function flushPlaygroundAISessionSync(
	editor: Editor,
	reason = "manual",
	signal?: AbortSignal,
): Promise<void> {
	const syncState = getEditorSyncState(editor);
	pendingSyncEditor = editor;
	pendingSyncReason = reason;

	if (pendingSyncTimer != null) {
		window.clearTimeout(pendingSyncTimer);
		pendingSyncTimer = null;
	}

	if (activeRequestCount > 0) {
		updateState({ hasPendingSync: syncState.revision > syncState.syncedRevision });
		return;
	}

	if (syncState.revision <= syncState.syncedRevision) {
		updateState({ hasPendingSync: false });
		return;
	}

	if (pendingSyncPromise) {
		return pendingSyncPromise;
	}

	pendingSyncPromise = syncPlaygroundAISession(editor, signal).finally(() => {
		pendingSyncPromise = null;
		if (activeRequestCount === 0 && state.hasPendingSync && pendingSyncEditor) {
			queuePlaygroundAISessionSync(pendingSyncEditor, pendingSyncReason);
		}
	});

	return pendingSyncPromise;
}

export async function requestPlaygroundAIResponse(
	editor: Editor,
	prompt: string,
	signal?: AbortSignal,
	options?: {
		isolatedSession?: boolean;
	},
): Promise<Response> {
	const updateClientState = options?.isolatedSession !== true;
	const sessionId = options?.isolatedSession
		? await createPlaygroundAISession(signal, { persistToState: false })
		: await ensurePlaygroundAISession(signal);
	if (options?.isolatedSession) {
		await syncPlaygroundAISessionWithId(sessionId, editor, signal, {
			updateClientState: false,
		});
	} else {
		await flushPlaygroundAISessionSync(editor, "request", signal);
	}
	logAutocompleteDebug("ai request starting", {
		sessionId,
		promptLength: prompt.length,
		isolatedSession: options?.isolatedSession ?? false,
	});

	activeRequestCount += 1;
	latestRequestStartedAt = performance.now();
	if (updateClientState) {
		updateState({
			phase: "thinking",
			lastError: null,
			lastRequest: {
				requestId: null,
				sessionId,
				requestMode: null,
				requestModel: null,
				contextFormat: null,
				firstToolStartMs: null,
				firstToolResultMs: null,
				firstTextDeltaServerMs: null,
				firstTextDeltaBrowserMs: null,
				totalServerMs: null,
				totalBrowserMs: null,
				toolCallCount: 0,
				toolExecutionMs: null,
				contextBytesJson: null,
				contextEstimatedTokensJson: null,
			},
		});
	}

	try {
		const response = await fetch(PLAYGROUND_AI_ENDPOINT, {
			method: "POST",
			headers: {
				"content-type": "application/json",
			},
			body: JSON.stringify({
				sessionId,
				prompt,
			}),
			signal,
		});
		logAutocompleteDebug("ai request response received", {
			ok: response.ok,
			status: response.status,
			statusText: response.statusText,
		});

		if (!response.ok) {
			const message = await readErrorMessage(response);
			logAutocompleteDebug("ai request failed before stream", {
				status: response.status,
				message,
			});
			if (
				options?.isolatedSession &&
				response.status === 409 &&
				message === PLAYGROUND_AI_ACTIVE_REQUEST_CONFLICT
			) {
				throw new Error(
					"Autocomplete isolated session unexpectedly had an active AI request.",
				);
			}
			throw new Error(message);
		}

		return response;
	} catch (error) {
		logAutocompleteDebug("ai request threw", {
			error: error instanceof Error ? error.message : String(error),
		});
		finishActiveRequest("error", { updateClientState });
		if (updateClientState) {
			updateState({
				lastError: error instanceof Error ? error.message : String(error),
			});
		}
		throw error;
	}
}

export async function* streamPlaygroundAIResponse(
	editor: Editor,
	prompt: string,
	signal?: AbortSignal,
	options?: {
		isolatedSession?: boolean;
	},
): AsyncIterable<PlaygroundStreamChunk> {
	const updateClientState = options?.isolatedSession !== true;
	const response = await requestPlaygroundAIResponse(
		editor,
		prompt,
		signal,
		options,
	);
	let finishedRequest = false;
	logAutocompleteDebug("ai stream opened");

	if (!response.body) {
		const message = await readErrorMessage(response);
		logAutocompleteDebug("ai stream missing response body", {
			message,
		});
		const chunk = {
			type: "error",
			error: message,
		} satisfies PlaygroundStreamChunk;
		if (updateClientState) {
			applyPlaygroundAIChunk(chunk);
		}
		finishedRequest = true;
		yield chunk;
		return;
	}

	try {
		for await (const chunk of readPlaygroundAIStream(response.body)) {
			logAutocompleteDebug("ai stream chunk received", {
				type: chunk.type ?? "unknown",
			});
			if (updateClientState) {
				applyPlaygroundAIChunk(chunk);
			}
			if (chunk.type === "done" || chunk.type === "error") {
				finishedRequest = true;
			}
			yield chunk;
		}
	} finally {
		if (!finishedRequest) {
			logAutocompleteDebug("ai stream closed without terminal chunk", {
				aborted: signal?.aborted ?? false,
			});
			finishActiveRequest(signal?.aborted ? "complete" : "error", {
				updateClientState,
			});
		}
	}
}

export function applyPlaygroundAIChunk(
	chunk: PlaygroundStreamChunk,
): void {
	if (chunk.type === "meta") {
		updateState({
			sessionId:
				typeof chunk.sessionId === "string" ? chunk.sessionId : state.sessionId,
			lastRequest: {
				...getLastRequest(),
				requestId:
					typeof chunk.requestId === "string" ? chunk.requestId : getLastRequest().requestId,
				sessionId:
					typeof chunk.sessionId === "string" ? chunk.sessionId : getLastRequest().sessionId,
				requestMode:
					typeof chunk.requestMode === "string"
						? chunk.requestMode
						: getLastRequest().requestMode,
				requestModel:
					typeof chunk.requestModel === "string"
						? chunk.requestModel
						: getLastRequest().requestModel,
				contextFormat:
					typeof chunk.contextFormat === "string"
						? chunk.contextFormat
						: getLastRequest().contextFormat,
			},
		});
		return;
	}

	if (chunk.type === "phase") {
		const phase = toPhase(chunk.phase);
		updateState({ phase });
		return;
	}

	if (chunk.type === "metrics") {
		updateState({
			lastRequest: {
				...getLastRequest(),
				requestId:
					typeof chunk.requestId === "string" ? chunk.requestId : getLastRequest().requestId,
				sessionId:
					typeof chunk.sessionId === "string" ? chunk.sessionId : getLastRequest().sessionId,
				requestMode:
					typeof chunk.requestMode === "string"
						? chunk.requestMode
						: getLastRequest().requestMode,
				requestModel:
					typeof chunk.requestModel === "string"
						? chunk.requestModel
						: getLastRequest().requestModel,
				contextFormat:
					typeof chunk.contextFormat === "string"
						? chunk.contextFormat
						: getLastRequest().contextFormat,
				firstToolStartMs: toNumberOrNull(chunk.firstToolStartMs),
				firstToolResultMs: toNumberOrNull(chunk.firstToolResultMs),
				firstTextDeltaServerMs: toNumberOrNull(chunk.firstTextDeltaServerMs),
				totalServerMs: toNumberOrNull(chunk.totalServerMs),
				toolCallCount: toNumberOrZero(chunk.toolCallCount),
				toolExecutionMs: toNumberOrNull(chunk.toolExecutionMs),
				contextBytesJson: toNumberOrNull(chunk.contextBytesJson),
				contextEstimatedTokensJson: toNumberOrNull(chunk.contextEstimatedTokensJson),
				firstTextDeltaBrowserMs: getLastRequest().firstTextDeltaBrowserMs,
				totalBrowserMs: getLastRequest().totalBrowserMs,
			},
		});
		return;
	}

	if (
		chunk.type === "text-delta" &&
		typeof chunk.delta === "string" &&
		getLastRequest().firstTextDeltaBrowserMs == null
	) {
		updateState({
			lastRequest: {
				...getLastRequest(),
				firstTextDeltaBrowserMs: performance.now() - latestRequestStartedAt,
			},
			phase: "writing",
		});
		return;
	}

	if (chunk.type === "app-partial" || chunk.type === "app-final") {
		updateState({ phase: "writing" });
		return;
	}

	if (chunk.type === "done") {
		finishActiveRequest("complete");
		return;
	}

	if (chunk.type === "error") {
		finishActiveRequest("error");
		updateState({
			lastError:
				typeof chunk.error === "string"
					? chunk.error
					: chunk.error instanceof Error
						? chunk.error.message
						: "The playground AI request failed.",
		});
	}
}

export async function* readPlaygroundAIStream(
	stream: ReadableStream<Uint8Array>,
): AsyncIterable<PlaygroundStreamChunk> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = "";

	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";

			for (const line of lines) {
				const trimmedLine = line.trim();
				if (!trimmedLine) {
					continue;
				}

				yield JSON.parse(trimmedLine) as PlaygroundStreamChunk;
			}
		}

		const trailingLine = buffer.trim();
		if (trailingLine) {
			yield JSON.parse(trailingLine) as PlaygroundStreamChunk;
		}
	} finally {
		reader.releaseLock();
	}
}

export function cancelQueuedPlaygroundAISessionSync(): void {
	if (pendingSyncTimer != null) {
		window.clearTimeout(pendingSyncTimer);
		pendingSyncTimer = null;
	}
}

async function syncPlaygroundAISession(
	editor: Editor,
	signal?: AbortSignal,
): Promise<void> {
	const sessionId = await ensurePlaygroundAISession(signal);
	try {
		await syncPlaygroundAISessionWithId(sessionId, editor, signal, {
			updateClientState: true,
		});
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "Playground session not found."
		) {
			updateState({
				sessionId: null,
				hasPendingSync: true,
				lastError: null,
			});
			const nextSessionId = await ensurePlaygroundAISession(signal);
			await syncPlaygroundAISessionWithId(nextSessionId, editor, signal, {
				updateClientState: true,
			});
			return;
		}
		throw error;
	}
}

async function createPlaygroundAISession(
	signal?: AbortSignal,
	options?: {
		persistToState?: boolean;
	},
): Promise<string> {
	if (options?.persistToState) {
		updateState({
			phase: "creating-session",
			lastError: null,
		});
	}

	const response = await fetch(PLAYGROUND_AI_SESSION_ENDPOINT, {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		signal,
	});

	if (!response.ok) {
		const message = await readErrorMessage(response);
		if (options?.persistToState) {
			updateState({
				phase: "error",
				lastError: message,
			});
		}
		throw new Error(message);
	}

	const payload = (await response.json()) as { sessionId?: unknown };
	if (typeof payload.sessionId !== "string" || !payload.sessionId) {
		const message = "The playground AI session response was missing a session ID.";
		if (options?.persistToState) {
			updateState({
				phase: "error",
				lastError: message,
			});
		}
		throw new Error(message);
	}

	if (options?.persistToState) {
		updateState({
			sessionId: payload.sessionId,
			phase: "idle",
			lastError: null,
		});
	}

	return payload.sessionId;
}

async function syncPlaygroundAISessionWithId(
	sessionId: string,
	editor: Editor,
	signal?: AbortSignal,
	options?: {
		updateClientState?: boolean;
	},
): Promise<void> {
	const startedAt = performance.now();
	const syncState = getEditorSyncState(editor);

	if (options?.updateClientState !== false) {
		updateState({
			syncStatus: "syncing",
			phase: state.phase === "idle" ? "syncing" : state.phase,
			lastError: null,
		});
	}

	const response = await fetch(PLAYGROUND_AI_SESSION_SYNC_ENDPOINT, {
		method: "POST",
		headers: {
			"content-type": "application/json",
		},
		body: JSON.stringify({
			sessionId,
			editorState: serializeEditorState(editor),
		}),
		signal,
	});

	if (!response.ok) {
		const message = await readErrorMessage(response);
		if (
			response.status === 409 &&
			message === PLAYGROUND_AI_ACTIVE_SYNC_CONFLICT
		) {
			if (options?.updateClientState !== false) {
				updateState({
					syncStatus: "idle",
					phase: activeRequestCount > 0 ? state.phase : "idle",
					hasPendingSync: true,
					lastError: null,
				});
			}
			return;
		}
		if (options?.updateClientState !== false) {
			updateState({
				syncStatus: "error",
				phase: "error",
				lastError: message,
			});
		}
		throw new Error(message);
	}

	const payload = (await response.json()) as { sessionId?: unknown };
	syncState.syncedRevision = syncState.revision;

	if (options?.updateClientState !== false) {
		updateState({
			sessionId:
				typeof payload.sessionId === "string" ? payload.sessionId : state.sessionId,
			syncStatus: "idle",
			phase: activeRequestCount > 0 ? state.phase : "idle",
			lastSyncMs: performance.now() - startedAt,
			lastSyncAt: Date.now(),
			hasPendingSync: false,
			lastError: null,
		});
	}
}

function getEditorSyncState(editor: Editor): {
	revision: number;
	syncedRevision: number;
} {
	const existing = editorSyncState.get(editor);
	if (existing) {
		return existing;
	}
	const initial = {
		revision: 0,
		syncedRevision: -1,
	};
	editorSyncState.set(editor, initial);
	return initial;
}

function finishActiveRequest(
	nextPhase: Extract<PlaygroundAIPhase, "complete" | "error">,
	options?: {
		updateClientState?: boolean;
	},
) {
	activeRequestCount = Math.max(0, activeRequestCount - 1);
	if (options?.updateClientState !== false) {
		updateState({
			phase: activeRequestCount > 0 ? state.phase : "idle",
			lastRequest: {
				...getLastRequest(),
				totalBrowserMs: performance.now() - latestRequestStartedAt,
			},
		});
	}

	if (activeRequestCount === 0 && state.hasPendingSync && pendingSyncEditor) {
		queuePlaygroundAISessionSync(pendingSyncEditor, pendingSyncReason);
	}

	if (nextPhase === "error" && options?.updateClientState !== false) {
		updateState({ phase: "error" });
	}
}

function getLastRequest(): PlaygroundAIRequestMetrics {
	return (
		state.lastRequest ?? {
			requestId: null,
			sessionId: state.sessionId,
			contextFormat: null,
			requestModel: null,
			firstToolStartMs: null,
			firstToolResultMs: null,
			firstTextDeltaServerMs: null,
			firstTextDeltaBrowserMs: null,
			totalServerMs: null,
			totalBrowserMs: null,
			toolCallCount: 0,
			toolExecutionMs: null,
			requestMode: null,
			contextBytesJson: null,
			contextEstimatedTokensJson: null,
		}
	);
}

function updateState(partial: Partial<PlaygroundAIClientState>): void {
	state = {
		...state,
		...partial,
	};

	for (const callback of subscribers) {
		callback();
	}
}

function toNumberOrNull(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toNumberOrZero(value: unknown): number {
	return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function toPhase(value: unknown): PlaygroundAIPhase {
	switch (value) {
		case "creating-session":
		case "syncing":
		case "thinking":
		case "tool-calling":
		case "writing":
		case "complete":
		case "error":
		case "idle":
			return value;
		default:
			return "idle";
	}
}

async function readErrorMessage(response: Response): Promise<string> {
	try {
		const payload = (await response.json()) as { error?: unknown };
		if (typeof payload.error === "string") {
			return payload.error;
		}
	} catch {
		// Fall back to the HTTP status text when the body is not JSON.
	}

	if (
		response.status === 500 &&
		(response.url.includes(PLAYGROUND_AI_ENDPOINT) ||
			response.url.includes(PLAYGROUND_AI_SESSION_ENDPOINT) ||
			response.url.includes(PLAYGROUND_AI_SESSION_SYNC_ENDPOINT))
	) {
		return "The playground AI backend is unavailable. Make sure `pnpm dev:backend` is running, then try again.";
	}

	return response.statusText || "The playground AI request failed.";
}
