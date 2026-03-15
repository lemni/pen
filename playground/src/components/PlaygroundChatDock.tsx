import type { Editor } from "@pen/types";
import { useAISessionActions, useAISessions, useSuggestions } from "@pen/react";
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type FormEvent,
} from "react";
import { usePlaygroundAIState } from "../hooks/usePlaygroundAISession";
import { collectNewlyResolvedTurnIds } from "../utils/chatTurnResolution";
import { DebugPanel } from "./DebugPanel";
import "./PlaygroundChatDock.css";

type PlaygroundChatDockProps = {
	editor: Editor;
};

type PlaygroundChatMessageRole = "user" | "assistant";
type PlaygroundChatMessageStatus = "complete" | "streaming" | "error";
type PlaygroundDockPanel = "chat" | "debug";

interface PlaygroundChatMessage {
	id: string;
	role: PlaygroundChatMessageRole;
	content: string;
	status: PlaygroundChatMessageStatus;
	sessionId?: string;
	turnId?: string;
}

const DEFAULT_CHAT_PROMPT =
	"Write a story";
const PLAYGROUND_CHAT_CONTEXT_LABEL = "Document";
const PLAYGROUND_CHAT_MODE_LABEL = "Auto";

export function PlaygroundChatDock({
	editor,
}: PlaygroundChatDockProps) {
	const sessionActions = useAISessionActions(editor);
	const sessions = useAISessions(editor);
	const suggestions = useSuggestions(editor);
	const playgroundAIState = usePlaygroundAIState();
	const bottomChatSessionIdRef = useRef<string | null>(null);
	const transcriptRef = useRef<HTMLDivElement | null>(null);
	const [draft, setDraft] = useState(DEFAULT_CHAT_PROMPT);
	const [isStreaming, setIsStreaming] = useState(false);
	const [activePanel, setActivePanel] = useState<PlaygroundDockPanel>("chat");
	const [messages, setMessages] = useState<readonly PlaygroundChatMessage[]>(() => []);
	const [lastError, setLastError] = useState<string | null>(null);
	const [resolvingTurnIds, setResolvingTurnIds] = useState<readonly string[]>([]);
	const [resolvedTurnIds, setResolvedTurnIds] = useState<readonly string[]>([]);
	const previousPendingChangeCountsRef = useRef<ReadonlyMap<string, number>>(new Map());

	const bottomChatSession =
		sessions.find((session) => session.id === bottomChatSessionIdRef.current) ?? null;
	const bottomChatTurnPendingState = useMemo(() => {
		if (!bottomChatSession) {
			return new Map<string, { suggestionIds: readonly string[]; pendingReviewItemCount: number }>();
		}
		const pendingSuggestionIdSet = new Set(bottomChatSession.pendingSuggestionIds);
		const pendingReviewItemIdSet = new Set(bottomChatSession.pendingReviewItemIds);
		const documentSuggestionIdSet = new Set(
			suggestions
				.filter((suggestion) => suggestion.sessionId === bottomChatSession.id)
				.map((suggestion) => suggestion.id),
		);
		return new Map(
			bottomChatSession.turns.map((turn) => {
				const suggestionIds = turn.suggestionIds.filter(
					(suggestionId) =>
						pendingSuggestionIdSet.has(suggestionId) &&
						documentSuggestionIdSet.has(suggestionId),
				);
				const pendingReviewItemCount = turn.reviewItemIds.filter((reviewItemId) =>
					pendingReviewItemIdSet.has(reviewItemId),
				).length;
				return [turn.id, { suggestionIds, pendingReviewItemCount }];
			}),
		);
	}, [bottomChatSession, suggestions]);
	const sessionPreview = playgroundAIState.sessionId
		? playgroundAIState.sessionId.slice(0, 8)
		: "pending";
	const statusLabel = isStreaming
		? formatBackendPhase(playgroundAIState.phase)
		: lastError
			? "Error"
			: "Ready";

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		const prompt = draft.trim();
		if (!prompt || isStreaming) {
			return;
		}

		const userMessageId = crypto.randomUUID();
		const assistantMessageId = crypto.randomUUID();
		setIsStreaming(true);
		setLastError(null);
		setDraft("");
		setMessages((currentMessages) => [
			...currentMessages,
			{
				id: userMessageId,
				role: "user",
				content: prompt,
				status: "complete",
			},
			{
				id: assistantMessageId,
				role: "assistant",
				content: "Writing in the editor...",
				status: "streaming",
			},
		]);

		try {
			let sessionId = bottomChatSessionIdRef.current;
			if (!sessionId) {
				const session = sessionActions.startSession({
					surface: "bottom-chat",
					target: "document",
				});
				sessionId = session?.id ?? null;
				bottomChatSessionIdRef.current = sessionId;
			}
			if (!sessionId) {
				throw new Error("Unable to start a bottom chat AI session.");
			}

			const generation = await sessionActions.runSessionPrompt(sessionId, prompt, {
				target: "document",
			});
			const reviewItemCount = generation?.reviewItems?.length ?? 0;
			const suggestionCount = generation?.suggestionIds?.length ?? 0;
			const receiptStatus = generation?.mutationReceipt?.status ?? null;
			const assistantContent =
				receiptStatus === "invalid" || generation?.planState === "rejected"
					? "The agent response could not be applied."
					: receiptStatus === "staged_review" ||
						reviewItemCount > 0
						? "Staged changes for review."
						: receiptStatus === "staged_suggestions" ||
							suggestionCount > 0
							? "Staged suggestions in the editor."
							: receiptStatus === "applied"
								? "Wrote to the editor."
								: "No changes were produced.";

			setMessages((currentMessages) =>
				updateChatMessage(currentMessages, assistantMessageId, (message) => ({
					...message,
					status: "complete",
					content: assistantContent,
					sessionId,
					turnId: generation?.turnId,
				})),
			);
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "The playground agent failed.";
			setLastError(message);
			setMessages((currentMessages) =>
				updateChatMessage(currentMessages, assistantMessageId, (chatMessage) => ({
					...chatMessage,
					status: "error",
					content: message,
				})),
			);
		} finally {
			setIsStreaming(false);
		}
	};

	const handleStop = () => {
		const sessionId = bottomChatSessionIdRef.current;
		if (sessionId) {
			sessionActions.cancelSession(sessionId);
		}
		setIsStreaming(false);
		setMessages((currentMessages) => {
			const lastAssistantMessage = [...currentMessages]
				.reverse()
				.find((message) => message.role === "assistant");
			if (!lastAssistantMessage) {
				return currentMessages;
			}

			return updateChatMessage(
				currentMessages,
				lastAssistantMessage.id,
				(message) => ({
					...message,
					status: "complete",
					content: "Stopped.",
				}),
			);
		});
	};

	const handleKeepAllForTurn = (sessionId: string, turnId: string) => {
		const pendingState = bottomChatTurnPendingState.get(turnId);
		const pendingChangeCount =
			(pendingState?.suggestionIds.length ?? 0) +
			(pendingState?.pendingReviewItemCount ?? 0);
		if (pendingChangeCount === 0) {
			return;
		}
		setResolvingTurnIds((currentTurnIds) =>
			currentTurnIds.includes(turnId)
				? currentTurnIds
				: [...currentTurnIds, turnId],
		);
		const accepted = sessionActions.acceptSessionTurn(sessionId, turnId);
		if (!accepted) {
			setResolvingTurnIds((currentTurnIds) =>
				currentTurnIds.filter((currentTurnId) => currentTurnId !== turnId),
			);
			setLastError("Unable to keep all pending AI changes.");
			return;
		}
		setLastError(null);
		setResolvedTurnIds((currentTurnIds) =>
			currentTurnIds.includes(turnId)
				? currentTurnIds
				: [...currentTurnIds, turnId],
		);
	};

	useEffect(() => {
		if (resolvingTurnIds.length === 0) {
			return;
		}
		setResolvingTurnIds((currentTurnIds) =>
			currentTurnIds.filter((turnId) => {
				const pendingState = bottomChatTurnPendingState.get(turnId);
				return (
					(pendingState?.suggestionIds.length ?? 0) +
						(pendingState?.pendingReviewItemCount ?? 0) >
					0
				);
			}),
		);
	}, [
		bottomChatTurnPendingState,
		resolvingTurnIds.length,
	]);

	useEffect(() => {
		const nextPendingChangeCounts = new Map<string, number>();
		for (const message of messages) {
			if (message.role !== "assistant" || !message.turnId) {
				continue;
			}
			const pendingState = bottomChatTurnPendingState.get(message.turnId);
			const pendingChangeCount =
				(pendingState?.suggestionIds.length ?? 0) +
				(pendingState?.pendingReviewItemCount ?? 0);
			nextPendingChangeCounts.set(message.turnId, pendingChangeCount);
		}

		setResolvedTurnIds((currentTurnIds) =>
			collectNewlyResolvedTurnIds({
				currentResolvedTurnIds: currentTurnIds,
				previousPendingChangeCounts: previousPendingChangeCountsRef.current,
				nextPendingChangeCounts,
			}),
		);
		previousPendingChangeCountsRef.current = nextPendingChangeCounts;
	}, [bottomChatTurnPendingState, messages]);

	useEffect(() => {
		const transcript = transcriptRef.current;
		if (!transcript) {
			return;
		}

		transcript.scrollTop = transcript.scrollHeight;
	}, [messages]);

	useEffect(() => {
		if (!bottomChatSession || !bottomChatSessionIdRef.current) {
			return;
		}
		if (bottomChatSession.status !== "error") {
			return;
		}

		setIsStreaming(false);
	}, [bottomChatSession]);

	const switcherButtons = (
		<div className="playground-chat-switcher" role="tablist" aria-label="AI dock views">
			<button
				className="playground-chat-switcher-button"
				type="button"
				role="tab"
				aria-selected={activePanel === "chat"}
				data-active={activePanel === "chat" ? "" : undefined}
				onClick={() => setActivePanel("chat")}
			>
				<h3>Chat</h3>
			</button>
			<button
				className="playground-chat-switcher-button"
				type="button"
				role="tab"
				aria-selected={activePanel === "debug"}
				data-active={activePanel === "debug" ? "" : undefined}
				onClick={() => setActivePanel("debug")}
			>
				<h3>Debug</h3>
			</button>
		</div>
	);
	const chatMessageItems = messages.map((message) => {
		const pendingState =
			message.role === "assistant" && message.turnId
				? bottomChatTurnPendingState.get(message.turnId)
				: undefined;
		const pendingChangeCount =
			(pendingState?.suggestionIds.length ?? 0) +
			(pendingState?.pendingReviewItemCount ?? 0);
		const isResolvingTurn =
			message.turnId != null && resolvingTurnIds.includes(message.turnId);
		const visiblePendingChangeCount = isResolvingTurn ? 0 : pendingChangeCount;
		const canKeepAll =
			message.role === "assistant" &&
			message.status === "complete" &&
			!!message.sessionId &&
			!!message.turnId &&
			!isResolvingTurn &&
			pendingChangeCount > 0;
		const shouldShowAcceptedState =
			message.role === "assistant" &&
			message.turnId != null &&
			resolvedTurnIds.includes(message.turnId) &&
			pendingChangeCount === 0;
		return (
			<article
				key={message.id}
				className="playground-chat-message"
				data-role={message.role}
				data-status={message.status}
			>
				<div className="playground-chat-message-meta">
					<span
						className="playground-chat-message-role"
						data-role={message.role}
					>
						{message.role === "user" ? "You" : "Agent"}
					</span>
				</div>
				<div className="playground-chat-message-body">
					{message.content || (message.role === "assistant" ? "Thinking..." : "")}
				</div>
				{canKeepAll ? (
					<div className="playground-chat-message-actions">
						<div className="playground-chat-message-note">
							{visiblePendingChangeCount} pending change
							{visiblePendingChangeCount === 1 ? "" : "s"}
						</div>
						<button
							className="toolbar-button playground-chat-message-button"
							type="button"
							onClick={() => handleKeepAllForTurn(message.sessionId!, message.turnId!)}
						>
							Keep All
						</button>
					</div>
				) : shouldShowAcceptedState ? (
					<div className="playground-chat-message-actions">
						<div className="playground-chat-message-note">Changes resolved</div>
					</div>
				) : null}
			</article>
		);
	});

	return (
		<section
			className="playground-chat-shell"
			data-pen-ignore-pointer-gesture=""
		>
			<div className="playground-chat-toolbar">
				{switcherButtons}
			</div>
			<div className="playground-chat-window">
				{activePanel === "chat" ? (
					<>
						<div className="playground-chat-transcript" ref={transcriptRef}>
							{chatMessageItems}
						</div>

						<form className="playground-chat-form" onSubmit={handleSubmit}>
							<div className="playground-chat-composer">
								<textarea
									id="playground-agent-chat"
									className="playground-chat-input"
									value={draft}
									onChange={(event) => setDraft(event.target.value)}
									placeholder="Do anything with AI..."
								/>
								<div className="playground-chat-actions">
									<div className="playground-chat-button-row">
										{isStreaming ? (
											<button
												className="toolbar-button playground-chat-secondary-button"
												type="button"
												onClick={handleStop}
											>
												Stop
											</button>
										) : null}
										<button
											className="toolbar-button playground-chat-primary-button"
											type="submit"
											disabled={!draft.trim() || isStreaming}
										>
											Send
										</button>
									</div>
								</div>
							</div>
							{lastError ? (
								<div className="playground-chat-error">{lastError}</div>
							) : null}
						</form>
					</>
				) : (
					<div className="playground-chat-debug-view">
						<DebugPanel
							editor={editor}
							sessionId={bottomChatSession?.id ?? bottomChatSessionIdRef.current ?? undefined}
							variant="dock"
						/>
					</div>
				)}
			</div>
		</section>
	);
}

function updateChatMessage(
	messages: readonly PlaygroundChatMessage[],
	messageId: string,
	updater: (message: PlaygroundChatMessage) => PlaygroundChatMessage,
): readonly PlaygroundChatMessage[] {
	return messages.map((message) =>
		message.id === messageId ? updater(message) : message,
	);
}

function formatBackendPhase(phase: string): string {
	switch (phase) {
		case "creating-session":
			return "Starting session";
		case "tool-calling":
			return "Calling tools";
		case "thinking":
			return "Thinking";
		case "writing":
			return "Streaming";
		case "syncing":
			return "Syncing";
		case "error":
			return "Error";
		default:
			return "Ready";
	}
}
