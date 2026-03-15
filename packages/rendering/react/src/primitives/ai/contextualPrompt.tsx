import type { Editor } from "@pen/types";
import type { AIContextualPromptAnchor, AISession } from "@pen/ai";
import { getAIController } from "@pen/ai";
import React from "react";
import {
	domSelectionToEditor,
	getTextSelectionClientRects,
	queryBlockElement,
} from "../../field-editor/selectionBridge";
import { useAISessionActions } from "../../hooks/useAISessionActions";
import {
	queryEditorBlockElement,
	resolveEditorContentElement,
} from "../../utils/aiDomScope";
import { useSyncExternalStoreWithSelector } from "../../utils/useSyncExternalStoreWithSelector";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { useAIContext } from "./root";

export type ContextualPromptMode = "floating" | "inserted";
export type ContextualPromptSide = "top" | "bottom";

export interface ContextualPromptPlacement {
	anchorBlockId?: string;
	anchorRect: {
		top: number;
		left: number;
		width: number;
		height: number;
	};
	left: number;
	top: number;
	side: ContextualPromptSide;
}

export interface UseContextualPromptPlacementOptions {
	sessionId?: string;
	mode?: ContextualPromptMode;
	side?: ContextualPromptSide;
	sideOffset?: number;
	layoutRevision?: number;
	surfaceRef?: React.RefObject<HTMLElement | null>;
	containerRef?: React.RefObject<HTMLElement | null>;
}

const SESSION_VIEWPORT_PADDING = 8;

export function useContextualPromptSession(editor: Editor): AISession | null {
	const controller = getAIController(editor);

	return useSyncExternalStoreWithSelector(
		(callback) => {
			if (!controller) {
				return () => { };
			}
			return controller.subscribeSessions(callback);
		},
		() => controller?.getState() ?? null,
		() => null,
		(state) => {
			const activeSession =
				state?.sessions.find((session) => session.id === state.activeSessionId) ?? null;
			if (
				!activeSession ||
				activeSession.surface !== "inline-edit" ||
				activeSession.status === "cancelled" ||
				!activeSession.contextualPrompt?.composer.isOpen
			) {
				return null;
			}
			return activeSession;
		},
	);
}

export function useContextualPromptAnchor(
	editor: Editor,
	sessionId?: string,
): AIContextualPromptAnchor | null {
	const controller = getAIController(editor);

	return useSyncExternalStoreWithSelector(
		(callback) => {
			if (!controller) {
				return () => { };
			}
			return controller.subscribeSessions(callback);
		},
		() => controller?.getState() ?? null,
		() => null,
		(state) => {
			const session =
				state?.sessions.find((item) =>
					sessionId ? item.id === sessionId : item.id === state.activeSessionId,
				) ?? null;
			return session?.contextualPrompt?.anchor ?? null;
		},
	);
}

export function useContextualPromptPlacement(
	editor: Editor,
	options: UseContextualPromptPlacementOptions = {},
): ContextualPromptPlacement | null {
	const controller = getAIController(editor);
	const session = useContextualPromptSession(editor);
	const anchor = useContextualPromptAnchor(editor, options.sessionId);
	const {
		mode = "floating",
		side: preferredSide = "bottom",
		sideOffset = 8,
		layoutRevision,
		surfaceRef,
		containerRef,
	} = options;
	const [layout, setLayout] = React.useState<ContextualPromptPlacement | null>(null);

	React.useLayoutEffect(() => {
		const sessionId = options.sessionId ?? session?.id;
		if (!sessionId || !anchor || !surfaceRef?.current) {
			setLayout(null);
			return;
		}

		const aiRootElement = surfaceRef.current.closest("[data-pen-ai-root]");
		const hostElement =
			aiRootElement?.querySelector("[data-pen-editor-content]") ?? null;
		const containerElement =
			containerRef?.current ?? surfaceRef.current.parentElement ?? null;
		if (
			!(hostElement instanceof HTMLElement) ||
			!(containerElement instanceof HTMLElement)
		) {
			setLayout(null);
			return;
		}
		const activeSessionId = sessionId;
		const anchorState = anchor;
		const host = hostElement;
		const container = containerElement;

		let animationFrameId = 0;
		let resizeObserver: ResizeObserver | null = null;

		function measureLayout() {
			const surfaceElement = surfaceRef?.current ?? null;
			if (!surfaceElement) {
				setLayout(null);
				return;
			}

			const surfaceRect = surfaceElement.getBoundingClientRect();
			const hostRect = host.getBoundingClientRect();
			const containerRect = container.getBoundingClientRect();
			const containerScrollTop = container.scrollTop;
			const containerScrollLeft = container.scrollLeft;
			const liveSelectionRect = resolveLiveSelectionRect(
				host,
				anchorState.selectionSnapshot,
			);
			const anchorRect =
				mode === "inserted"
					? resolveInsertedAnchorRect(host, anchorState) ??
					resolveFallbackRect(anchorState.lastResolvedRect) ??
					resolveAnchorRect(host, anchorState)
					: liveSelectionRect ??
					resolveFallbackRect(anchorState.lastResolvedRect) ??
					resolveAnchorRect(host, anchorState);
			if (!anchorRect) {
				setLayout(null);
				return;
			}

			if (
				mode === "floating" &&
				liveSelectionRect &&
				!areRectsEqual(anchorState.lastResolvedRect, liveSelectionRect)
			) {
				controller?.setContextualPromptAnchorRect(activeSessionId, {
					top: liveSelectionRect.top,
					left: liveSelectionRect.left,
					width: liveSelectionRect.width,
					height: liveSelectionRect.height,
				});
			}

			const anchorTop = anchorRect.top - hostRect.top;
			const anchorBottom = anchorRect.bottom - hostRect.top;
			const anchorLeft = anchorRect.left - hostRect.left;
			const availableWidth = hostRect.width;
			const availableHeight = hostRect.height;
			let side = preferredSide;
			let top =
				mode === "inserted"
					? anchorTop - sideOffset - surfaceRect.height
					: anchorBottom + sideOffset;

			if (mode === "floating") {
				if (side === "top") {
					top = anchorTop - sideOffset - surfaceRect.height;
					if (top < SESSION_VIEWPORT_PADDING) {
						side = "bottom";
						top = anchorBottom + sideOffset;
					}
				} else {
					top = anchorBottom + sideOffset;
					if (top + surfaceRect.height > availableHeight - SESSION_VIEWPORT_PADDING) {
						side = "top";
						top = anchorTop - sideOffset - surfaceRect.height;
					}
				}
			} else {
				side = "top";
			}

			let left = anchorLeft + anchorRect.width / 2 - surfaceRect.width / 2;
			left = Math.max(
				SESSION_VIEWPORT_PADDING,
				Math.min(
					left,
					availableWidth - surfaceRect.width - SESSION_VIEWPORT_PADDING,
				),
			);

			const nextLayout: ContextualPromptPlacement = {
				top: hostRect.top - containerRect.top + containerScrollTop + top,
				left: hostRect.left - containerRect.left + containerScrollLeft + left,
				side,
				anchorBlockId: anchorState.focusBlockId ?? undefined,
				anchorRect: {
					top:
						hostRect.top - containerRect.top + containerScrollTop + anchorTop,
					left:
						hostRect.left - containerRect.left + containerScrollLeft + anchorLeft,
					width: anchorRect.width,
					height: anchorRect.height,
				},
			};
			setLayout((currentLayout) =>
				areContextualPromptLayoutsEqual(currentLayout, nextLayout)
					? currentLayout
					: nextLayout,
			);
		}

		function scheduleMeasure() {
			window.cancelAnimationFrame(animationFrameId);
			animationFrameId = window.requestAnimationFrame(measureLayout);
		}

		measureLayout();
		window.addEventListener("resize", scheduleMeasure);
		window.addEventListener("scroll", scheduleMeasure, true);
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				scheduleMeasure();
			});
			resizeObserver.observe(surfaceRef.current);
			resizeObserver.observe(host);
			resizeObserver.observe(container);
		}

		return () => {
			window.cancelAnimationFrame(animationFrameId);
			window.removeEventListener("resize", scheduleMeasure);
			window.removeEventListener("scroll", scheduleMeasure, true);
			resizeObserver?.disconnect();
		};
	}, [
		anchor,
		containerRef,
		controller,
		layoutRevision,
		mode,
		options.sessionId,
		preferredSide,
		session?.id,
		sideOffset,
		surfaceRef,
	]);

	return layout;
}

export interface AIContextualPromptTriggerProps extends AsChildProps {
	shortcut?: string;
	ref?: React.Ref<HTMLElement>;
}

export function AIContextualPromptTrigger(
	props: AIContextualPromptTriggerProps,
) {
	const { shortcut, ...rest } = props;
	const { controller, editor } = useAIContext();
	const activeSelection = editor.selection;
	const isSelectionEligible =
		activeSelection?.type === "text" && !activeSelection.isCollapsed;

	const openContextualPrompt = React.useCallback(() => {
		if (!isSelectionEligible) {
			return;
		}
		controller?.openContextualPrompt({
			surface: "inline-edit",
			target: "selection",
		});
	}, [controller, isSelectionEligible]);

	const handleClick = () => {
		openContextualPrompt();
	};

	const handlePointerDown = (event: React.PointerEvent<HTMLElement>) => {
		event.preventDefault();
		openContextualPrompt();
	};

	React.useEffect(() => {
		if (!shortcut) {
			return;
		}
		const handleKeyDown = (event: KeyboardEvent) => {
			if (!matchesShortcut(event, shortcut)) {
				return;
			}
			event.preventDefault();
			openContextualPrompt();
		};
		document.addEventListener("keydown", handleKeyDown, true);
		return () => document.removeEventListener("keydown", handleKeyDown, true);
	}, [openContextualPrompt, shortcut]);

	const triggerProps: AsChildProps & {
		ref?: React.Ref<HTMLElement>;
	} & Record<string, unknown> = {
		...rest,
		onPointerDown: handlePointerDown,
		onClick: handleClick,
	};

	return renderAsChild(
		triggerProps,
		"button",
		{
			type: "button",
			"data-pen-ai-contextual-prompt-trigger": "",
			disabled: !isSelectionEligible,
		},
	);
}

export interface AIContextualPromptSurfaceProps extends AsChildProps {
	mode?: ContextualPromptMode;
	side?: ContextualPromptSide;
	sideOffset?: number;
	containerRef?: React.RefObject<HTMLElement | null>;
	ref?: React.Ref<HTMLElement>;
}

export function AIContextualPromptSurface(
	props: AIContextualPromptSurfaceProps,
) {
	const {
		mode = "floating",
		side = "bottom",
		sideOffset = 8,
		containerRef,
		ref,
		...rest
	} = props;
	const { editor } = useAIContext();
	const session = useContextualPromptSession(editor);
	const surfaceRef = React.useRef<HTMLElement | null>(null);
	const [layoutRevision, setLayoutRevision] = React.useState(0);
	const insertedSpacingRef = React.useRef<{
		block: HTMLElement | null;
		reservedSpace: number;
	}>({
		block: null,
		reservedSpace: 0,
	});
	const previousAnchorSpacingRef = React.useRef<{
		block: HTMLElement;
		marginTop: string;
	} | null>(null);
	const layout = useContextualPromptPlacement(editor, {
		layoutRevision,
		mode,
		side,
		sideOffset,
		surfaceRef,
		containerRef,
	});

	React.useLayoutEffect(() => {
		const previousAnchorSpacing = previousAnchorSpacingRef.current;
		if (previousAnchorSpacing) {
			previousAnchorSpacing.block.style.marginTop = previousAnchorSpacing.marginTop;
			delete previousAnchorSpacing.block.dataset.penAiInsertedAnchor;
			previousAnchorSpacingRef.current = null;
		}

		if (
			mode !== "inserted" ||
			!layout?.anchorBlockId ||
			!surfaceRef.current ||
			!layout
		) {
			insertedSpacingRef.current = {
				block: null,
				reservedSpace: 0,
			};
			return;
		}

		const aiRootElement = surfaceRef.current.closest("[data-pen-ai-root]");
		const hostElement =
			aiRootElement?.querySelector("[data-pen-editor-content]") ?? null;
		if (!(hostElement instanceof HTMLElement)) {
			return;
		}

		const anchorBlock = queryBlockElement(hostElement, layout.anchorBlockId);
		if (!(anchorBlock instanceof HTMLElement)) {
			return;
		}

		const promptHeight = surfaceRef.current.getBoundingClientRect().height;
		const reservedSpace = Math.ceil(promptHeight + sideOffset);
		const previousInlineMarginTop = anchorBlock.style.marginTop;
		anchorBlock.style.marginTop = `${reservedSpace}px`;
		anchorBlock.dataset.penAiInsertedAnchor = "";
		if (
			insertedSpacingRef.current.block !== anchorBlock ||
			insertedSpacingRef.current.reservedSpace !== reservedSpace
		) {
			insertedSpacingRef.current = {
				block: anchorBlock,
				reservedSpace,
			};
			setLayoutRevision((currentRevision) => currentRevision + 1);
		}
		previousAnchorSpacingRef.current = {
			block: anchorBlock,
			marginTop: previousInlineMarginTop,
		};

		return () => {
			const currentAnchorSpacing = previousAnchorSpacingRef.current;
			if (!currentAnchorSpacing) {
				return;
			}
			currentAnchorSpacing.block.style.marginTop = currentAnchorSpacing.marginTop;
			delete currentAnchorSpacing.block.dataset.penAiInsertedAnchor;
			previousAnchorSpacingRef.current = null;
			insertedSpacingRef.current = {
				block: null,
				reservedSpace: 0,
			};
		};
	}, [layout, mode, sideOffset]);

	if (!session || !session.contextualPrompt?.composer.isOpen) {
		return null;
	}

	const selectionOverlay = (
		<ContextualPromptSelectionOverlay
			session={session}
			layoutRevision={layoutRevision}
		/>
	);
	const surfaceChildren =
		props.asChild && React.isValidElement(props.children)
			? React.cloneElement(
				props.children as React.ReactElement<{ children?: React.ReactNode }>,
				{},
				<>
					{selectionOverlay}
					{(
						props.children as React.ReactElement<{ children?: React.ReactNode }>
					).props.children}
				</>,
			)
			: (
				<>
					{selectionOverlay}
					{props.children}
				</>
			);

	return renderAsChild(
		{
			...rest,
			ref: mergeRefs(ref, surfaceRef),
			children: surfaceChildren,
		},
		"div",
		{
			"data-pen-ai-contextual-prompt": "",
			"data-pen-ai-inline-session": "",
			"data-session-id": session.id,
			"data-status": session.status,
			"data-side": layout?.side ?? side,
			"data-mode": mode,
			"data-layout-ready": layout ? "" : undefined,
			"data-anchor-block-id": layout?.anchorBlockId,
			"data-pending-count":
				session.pendingSuggestionIds.length + session.pendingReviewItemIds.length,
			"data-running":
				session.status === "streaming" ? "" : undefined,
			"data-pen-ignore-pointer-gesture": "",
			"data-pen-ignore-transfer": "",
			style: {
				"--pen-ai-contextual-prompt-top": layout
					? `${Math.round(layout.top)}px`
					: "0px",
				"--pen-ai-inline-session-anchor-top": layout
					? `${Math.round(layout.top)}px`
					: "0px",
				"--pen-ai-contextual-prompt-left": layout
					? `${Math.round(layout.left)}px`
					: "0px",
				"--pen-ai-inline-session-anchor-left": layout
					? `${Math.round(layout.left)}px`
					: "0px",
				"--pen-ai-contextual-prompt-selection-top": layout
					? `${Math.round(layout.anchorRect.top)}px`
					: "0px",
				"--pen-ai-inline-session-selection-top": layout
					? `${Math.round(layout.anchorRect.top)}px`
					: "0px",
				"--pen-ai-contextual-prompt-selection-left": layout
					? `${Math.round(layout.anchorRect.left)}px`
					: "0px",
				"--pen-ai-inline-session-selection-left": layout
					? `${Math.round(layout.anchorRect.left)}px`
					: "0px",
				"--pen-ai-contextual-prompt-selection-width": layout
					? `${Math.round(layout.anchorRect.width)}px`
					: "0px",
				"--pen-ai-inline-session-selection-width": layout
					? `${Math.round(layout.anchorRect.width)}px`
					: "0px",
				"--pen-ai-contextual-prompt-selection-height": layout
					? `${Math.round(layout.anchorRect.height)}px`
					: "0px",
				"--pen-ai-inline-session-selection-height": layout
					? `${Math.round(layout.anchorRect.height)}px`
					: "0px",
			},
		},
	);
}

interface ContextualPromptSelectionOverlayProps {
	session: AISession;
	layoutRevision: number;
}

function ContextualPromptSelectionOverlay(
	props: ContextualPromptSelectionOverlayProps,
) {
	const { session, layoutRevision } = props;
	const { editor } = useAIContext();
	const [segments, setSegments] = React.useState<readonly DOMRect[]>([]);

	React.useLayoutEffect(() => {
		if (!session.contextualPrompt?.composer.isOpen) {
			setSegments([]);
			return;
		}

		const hostElement = resolvePromptHostElement(editor, session);
		if (!hostElement) {
			setSegments([]);
			return;
		}

		let frameId = 0;
		let resizeObserver: ResizeObserver | null = null;

		const measureSelection = () => {
			const nextSegments = resolvePromptSelectionRects(hostElement, session);
			setSegments((currentSegments) =>
				areRectListsEqual(currentSegments, nextSegments)
					? currentSegments
					: nextSegments,
			);
		};

		const scheduleMeasure = () => {
			window.cancelAnimationFrame(frameId);
			frameId = window.requestAnimationFrame(measureSelection);
		};

		measureSelection();
		window.addEventListener("resize", scheduleMeasure);
		window.addEventListener("scroll", scheduleMeasure, true);
		if (typeof ResizeObserver !== "undefined") {
			resizeObserver = new ResizeObserver(() => {
				scheduleMeasure();
			});
			resizeObserver.observe(hostElement);
		}

		return () => {
			window.cancelAnimationFrame(frameId);
			window.removeEventListener("resize", scheduleMeasure);
			window.removeEventListener("scroll", scheduleMeasure, true);
			resizeObserver?.disconnect();
		};
	}, [editor, layoutRevision, session]);

	if (segments.length === 0) {
		return null;
	}

	const segmentItems = segments.map((segment, index) => (
		<div
			key={`${index}-${segment.top}-${segment.left}-${segment.width}-${segment.height}`}
			data-pen-ai-contextual-prompt-selection-segment=""
			data-pen-ai-inline-session-selection-segment=""
			aria-hidden="true"
			style={{
				position: "fixed",
				top: `${segment.top}px`,
				left: `${segment.left}px`,
				width: `${segment.width}px`,
				height: `${segment.height}px`,
				pointerEvents: "none",
				background: "color-mix(in srgb, #2563eb 26%, transparent)",
				boxShadow:
					"inset 0 0 0 1px rgba(96, 165, 250, 0.72), inset 0 -1px 0 rgba(147, 197, 253, 0.92)",
				borderRadius: "4px",
				zIndex: 44,
			}}
		/>
	));

	return (
		<div
			data-pen-ai-contextual-prompt-selection-overlay=""
			data-pen-ai-inline-session-selection-overlay=""
			aria-hidden="true"
			style={{ pointerEvents: "none" }}
		>
			{segmentItems}
		</div>
	);
}

export interface AIContextualPromptComposerProps extends AsChildProps {
	placeholder?: string;
	autoFocus?: boolean;
	ref?: React.Ref<HTMLElement>;
}

export function AIContextualPromptComposer(
	props: AIContextualPromptComposerProps,
) {
	const { placeholder = "Edit selection", autoFocus = true, ref, ...rest } = props;
	const { editor, state } = useAIContext();
	const session = useContextualPromptSession(editor);
	const actions = useAISessionActions(editor);
	const inputRef = React.useRef<HTMLTextAreaElement | null>(null);
	const isRunningCurrentSession =
		state.activeGeneration?.sessionId != null &&
		state.activeGeneration.sessionId === session?.id &&
		state.activeGeneration.status === "streaming";
	const sessionTurns = session?.turns ?? [];
	const activeTurnId =
		state.activeGeneration?.turnId ?? session?.activeTurnId ?? null;
	const draftPrompt = session?.contextualPrompt?.composer.draftPrompt ?? "";
	const hasSubmittedPrompt = sessionTurns.length > 0;
	const latestTurnId = sessionTurns[sessionTurns.length - 1]?.id ?? null;

	React.useLayoutEffect(() => {
		if (!autoFocus || !session?.contextualPrompt?.composer.isOpen) {
			return;
		}
		let frameId = 0;
		let remainingAttempts = 3;

		const focusInput = () => {
			const input = inputRef.current;
			if (!input) {
				return;
			}
			if (input.ownerDocument.activeElement === input) {
				return;
			}
			input.focus({ preventScroll: true });
			const endOffset = input.value.length;
			input.setSelectionRange(endOffset, endOffset);
			if (input.ownerDocument.activeElement !== input && remainingAttempts > 0) {
				remainingAttempts -= 1;
				frameId = window.requestAnimationFrame(focusInput);
			}
		};

		focusInput();
		return () => {
			window.cancelAnimationFrame(frameId);
		};
	}, [
		autoFocus,
		session?.contextualPrompt?.composer.isOpen,
		session?.id,
		sessionTurns.length,
	]);

	if (!session) {
		return null;
	}
	const sessionId = session.id;
	const selectionSnapshot = session.contextualPrompt?.anchor.selectionSnapshot ?? null;
	const sessionLabel = resolveInlineSessionLabel(session);
	const [targetState, setTargetState] = React.useState<"active" | "pinned">(
		"active",
	);
	const targetHint = resolveInlineSessionTargetHint(targetState);

	function handleActionPointerDown(event: React.PointerEvent) {
		event.preventDefault();
	}

	function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
		event.preventDefault();
		const nextPrompt = draftPrompt.trim();
		if (!nextPrompt) {
			return;
		}
		void actions.runSessionPrompt(sessionId, nextPrompt, { target: "selection" });
	}

	function handleAcceptTurn(turnId: string) {
		const resolved = actions.resolveSessionTurn(sessionId, turnId, "accept");
		if (!resolved) {
			actions.resolveSession(sessionId, "accept");
		}
	}

	function handleRejectTurn(turnId: string) {
		const resolved = actions.resolveSessionTurn(sessionId, turnId, "reject");
		if (!resolved) {
			actions.resolveSession(sessionId, "reject");
		}
	}

	function handleDismiss() {
		if (isRunningCurrentSession) {
			actions.cancelSession(sessionId);
			return;
		}
		if (!hasSubmittedPrompt) {
			actions.cancelSession(sessionId);
			return;
		}
		const rejected = actions.rejectSession(sessionId);
		if (!rejected) {
			actions.cancelSession(sessionId);
		}
	}

	function handleComposerKeyDown(event: React.KeyboardEvent<HTMLElement>) {
		if (event.key !== "Escape") {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		handleDismiss();
	}

	React.useEffect(() => {
		if (!session.contextualPrompt?.composer.isOpen) {
			return;
		}

		const ownerDocument = inputRef.current?.ownerDocument ?? document;
		const handleDocumentKeyDown = (event: KeyboardEvent) => {
			if (event.key !== "Escape") {
				return;
			}
			const currentEditorRoot = inputRef.current?.closest(
				"[data-pen-editor-root]",
			) as HTMLElement | null;
			const targetElement =
				event.target instanceof HTMLElement
					? event.target
					: event.target instanceof Node
						? event.target.parentElement
						: null;
			const targetEditorRoot = targetElement?.closest(
				"[data-pen-editor-root]",
			) as HTMLElement | null;
			if (
				currentEditorRoot &&
				targetEditorRoot &&
				targetEditorRoot !== currentEditorRoot
			) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();
			event.stopImmediatePropagation?.();
			handleDismiss();
		};

		ownerDocument.addEventListener("keydown", handleDocumentKeyDown, true);
		return () => {
			ownerDocument.removeEventListener("keydown", handleDocumentKeyDown, true);
		};
	}, [
		handleDismiss,
		session.contextualPrompt?.composer.isOpen,
	]);

	React.useEffect(() => {
		if (!session.contextualPrompt?.composer.isOpen) {
			setTargetState("active");
			return;
		}

		const ownerDocument = inputRef.current?.ownerDocument ?? document;
		const promptElement = inputRef.current?.closest(
			"[data-pen-ai-contextual-prompt], [data-pen-ai-inline-session]",
		) as HTMLElement | null;
		const hostElement = resolvePromptHostElement(editor, session);

		const updateTargetState = () => {
			const nextTargetState = resolveInlineSessionTargetState(
				ownerDocument,
				hostElement,
				promptElement,
				selectionSnapshot ?? undefined,
			);
			const liveSelection = ownerDocument.getSelection();
			const liveRange =
				liveSelection && liveSelection.rangeCount > 0
					? liveSelection.getRangeAt(0)
					: null;
			const liveCommonAncestor =
				liveRange?.commonAncestorContainer instanceof Element
					? liveRange.commonAncestorContainer
					: liveRange?.commonAncestorContainer?.parentElement ?? null;
			if (
				nextTargetState === "pinned" &&
				liveSelection &&
				!liveSelection.isCollapsed &&
				liveCommonAncestor &&
				!(promptElement?.contains(liveCommonAncestor) ?? false)
			) {
				actions.suspendInlineSession(sessionId);
				return;
			}
			setTargetState(nextTargetState);
		};

		updateTargetState();
		ownerDocument.addEventListener("selectionchange", updateTargetState);
		ownerDocument.addEventListener("focusin", updateTargetState, true);
		ownerDocument.addEventListener("focusout", updateTargetState, true);
		return () => {
			ownerDocument.removeEventListener("selectionchange", updateTargetState);
			ownerDocument.removeEventListener("focusin", updateTargetState, true);
			ownerDocument.removeEventListener("focusout", updateTargetState, true);
		};
	}, [
		actions,
		selectionSnapshot,
		session,
		session.contextualPrompt?.composer.isOpen,
		sessionId,
	]);

	const turnItems = sessionTurns.map((turn) => {
		const pendingChangeCount = turn.suggestionIds.length + turn.reviewItemIds.length;
		const isTurnRunning =
			state.activeGeneration?.sessionId === sessionId &&
			state.activeGeneration.turnId === turn.id &&
			state.activeGeneration.status === "streaming";
		const shouldShowTurnActions = turn.id === latestTurnId;
		const canResolveTurn =
			pendingChangeCount > 0 &&
			turn.status !== "accepted" &&
			turn.status !== "rejected";
		return (
			<div
				key={turn.id}
				data-pen-ai-contextual-prompt-turn=""
				data-pen-ai-inline-session-turn=""
				data-turn-id={turn.id}
				data-turn-status={turn.status}
				data-active-turn={turn.id === activeTurnId ? "" : undefined}
			>
				<div
					data-pen-ai-contextual-prompt-prompt=""
					data-pen-ai-inline-session-prompt=""
				>
					{turn.prompt}
				</div>
				<div
					data-pen-ai-contextual-prompt-turn-meta=""
					data-pen-ai-inline-session-turn-meta=""
				>
					<span
						data-pen-ai-contextual-prompt-turn-status=""
						data-pen-ai-inline-session-turn-status=""
					>
						{resolveInlineSessionTurnStatusLabel(
							turn.status,
							pendingChangeCount,
							isTurnRunning,
						)}
					</span>
					{shouldShowTurnActions ? (
						<div
							data-pen-ai-contextual-prompt-turn-actions=""
							data-pen-ai-inline-session-turn-actions=""
						>
							<button
								type="button"
								data-pen-ai-inline-session-turn-accept=""
								onPointerDown={handleActionPointerDown}
								onClick={() => handleAcceptTurn(turn.id)}
								disabled={!canResolveTurn || isTurnRunning}
							>
								Accept
							</button>
							<button
								type="button"
								data-pen-ai-inline-session-turn-reject=""
								onPointerDown={handleActionPointerDown}
								onClick={() => handleRejectTurn(turn.id)}
								disabled={!canResolveTurn}
							>
								Reject
							</button>
						</div>
					) : null}
				</div>
			</div>
		);
	});
	const defaultChildren = (
		<form
			data-pen-ai-contextual-prompt-form=""
			data-pen-ai-inline-session-form=""
			onSubmit={handleSubmit}
			onKeyDown={handleComposerKeyDown}
		>
			<div
				data-pen-ai-contextual-prompt-header=""
				data-pen-ai-inline-session-header=""
			>
				<div
					data-pen-ai-contextual-prompt-target=""
					data-pen-ai-inline-session-target=""
				>
					<div
						data-pen-ai-contextual-prompt-label=""
						data-pen-ai-inline-session-label=""
					>
						{sessionLabel}
					</div>
					<div
						data-pen-ai-contextual-prompt-target-hint=""
						data-pen-ai-inline-session-target-hint=""
						data-target-state={targetState}
					>
						{targetHint}
					</div>
				</div>
			</div>
			{turnItems.length > 0 ? (
				<div
					data-pen-ai-contextual-prompt-history=""
					data-pen-ai-inline-session-history=""
				>
					{turnItems}
				</div>
			) : null}
			<textarea
				ref={inputRef}
				data-pen-ai-contextual-prompt-input=""
				data-pen-ai-inline-session-input=""
				placeholder={placeholder}
				value={draftPrompt}
				onKeyDown={handleComposerKeyDown}
				onChange={(event) =>
					actions.updateContextualPromptDraft(sessionId, event.target.value)
				}
			/>
			<div
				data-pen-ai-contextual-prompt-controls=""
				data-pen-ai-inline-session-controls=""
			>
				<div data-pen-ai-inline-session-spacer="" />
				<button
					type="submit"
					data-pen-ai-inline-session-submit=""
					onPointerDown={handleActionPointerDown}
					disabled={draftPrompt.trim().length === 0 || isRunningCurrentSession}
				>
					{turnItems.length > 0 ? "Add follow-up" : "Run edit"}
				</button>
			</div>
		</form>
	);

	const composerProps: AsChildProps & {
		ref?: React.Ref<HTMLElement>;
	} & Record<string, unknown> = {
		...rest,
		ref,
		children: props.children ?? defaultChildren,
	};

	return renderAsChild(
		composerProps,
		"div",
		{
			"data-pen-ai-contextual-prompt-composer": "",
		},
	);
}

function resolveAnchorRect(
	hostElement: HTMLElement,
	anchor: AIContextualPromptAnchor,
): DOMRect | null {
	if (anchor.selectionSnapshot?.blockRange.length) {
		const blockRects = anchor.selectionSnapshot.blockRange
			.map((blockId) => queryBlockElement(hostElement, blockId))
			.filter((element): element is HTMLElement => element instanceof HTMLElement)
			.map((element) => element.getBoundingClientRect());
		if (blockRects.length > 0) {
			return mergeDomRects(blockRects);
		}
	}
	if (anchor.focusBlockId) {
		const blockElement = queryBlockElement(hostElement, anchor.focusBlockId);
		if (blockElement) {
			return blockElement.getBoundingClientRect();
		}
	}
	return null;
}

function resolveInsertedAnchorRect(
	hostElement: HTMLElement,
	anchor: AIContextualPromptAnchor,
): DOMRect | null {
	if (!anchor.focusBlockId) {
		return resolveFallbackRect(anchor.lastResolvedRect);
	}

	const blockElement = queryBlockElement(hostElement, anchor.focusBlockId);
	if (!blockElement) {
		return resolveFallbackRect(anchor.lastResolvedRect);
	}

	return blockElement.getBoundingClientRect();
}

function resolvePromptSelectionRects(
	hostElement: HTMLElement,
	session: AISession,
): readonly DOMRect[] {
	const selectionSnapshot = session.contextualPrompt?.anchor.selectionSnapshot;
	if (selectionSnapshot) {
		const selectionRects = getTextSelectionClientRects(hostElement, {
			anchor: selectionSnapshot.anchor,
			focus: selectionSnapshot.focus,
		});
		if (selectionRects.length > 0) {
			return selectionRects;
		}
	}

	const fallbackRect = resolveFallbackRect(
		session.contextualPrompt?.anchor.lastResolvedRect ?? null,
	);
	if (fallbackRect) {
		return [fallbackRect];
	}

	if (selectionSnapshot?.blockRange.length) {
		const blockRects = selectionSnapshot.blockRange
			.map((blockId) => queryBlockElement(hostElement, blockId))
			.filter((element): element is HTMLElement => element instanceof HTMLElement)
			.map((element) => element.getBoundingClientRect());
		if (blockRects.length > 0) {
			return blockRects;
		}
	}

	return [];
}

function resolveLiveSelectionRect(
	hostElement: HTMLElement,
	selectionSnapshot: AIContextualPromptAnchor["selectionSnapshot"],
): DOMRect | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
		return null;
	}
	if (selectionSnapshot) {
		const domSelection = domSelectionToEditor(hostElement);
		if (!selectionMatchesSnapshot(domSelection, selectionSnapshot)) {
			return null;
		}
	}
	const range = selection.getRangeAt(0);
	if (!range?.commonAncestorContainer) {
		return null;
	}
	const commonAncestor =
		range.commonAncestorContainer instanceof Element
			? range.commonAncestorContainer
			: range.commonAncestorContainer.parentElement ?? null;
	if (!commonAncestor || !hostElement.contains(commonAncestor)) {
		return null;
	}
	const rect = range.getBoundingClientRect();
	return rect.width === 0 && rect.height === 0 ? null : rect;
}

function resolvePromptHostElement(
	editor: Editor,
	session: AISession,
): HTMLElement | null {
	const selectionSnapshot = session.contextualPrompt?.anchor.selectionSnapshot;
	const anchorBlockId =
		selectionSnapshot?.blockRange[0] ??
		selectionSnapshot?.anchor.blockId ??
		session.contextualPrompt?.anchor.focusBlockId ??
		null;
	if (anchorBlockId) {
		const anchorBlock = queryEditorBlockElement(editor, anchorBlockId);
		const rootElement =
			anchorBlock?.closest("[data-pen-ai-root]") ??
			anchorBlock?.closest("[data-pen-editor-root]");
		const hostElement =
			rootElement?.querySelector("[data-pen-editor-content]") ??
			(anchorBlock?.closest("[data-pen-editor-content]") as HTMLElement | null);
		if (hostElement instanceof HTMLElement) {
			return hostElement;
		}
	}

	return resolveEditorContentElement(editor);
}

function mergeDomRects(rects: readonly DOMRect[]): DOMRect | null {
	if (rects.length === 0) {
		return null;
	}
	const top = Math.min(...rects.map((rect) => rect.top));
	const left = Math.min(...rects.map((rect) => rect.left));
	const right = Math.max(...rects.map((rect) => rect.right));
	const bottom = Math.max(...rects.map((rect) => rect.bottom));
	return createDomRect(top, left, right - left, bottom - top);
}

function areContextualPromptLayoutsEqual(
	previous: ContextualPromptPlacement | null,
	next: ContextualPromptPlacement | null,
): boolean {
	if (previous === next) {
		return true;
	}
	if (!previous || !next) {
		return false;
	}
	return (
		previous.anchorBlockId === next.anchorBlockId &&
		previous.side === next.side &&
		previous.top === next.top &&
		previous.left === next.left &&
		previous.anchorRect.top === next.anchorRect.top &&
		previous.anchorRect.left === next.anchorRect.left &&
		previous.anchorRect.width === next.anchorRect.width &&
		previous.anchorRect.height === next.anchorRect.height
	);
}

function areRectListsEqual(
	previous: readonly DOMRect[],
	next: readonly DOMRect[],
): boolean {
	if (previous === next) {
		return true;
	}
	if (previous.length !== next.length) {
		return false;
	}
	return previous.every((rect, index) => {
		const nextRect = next[index];
		return (
			rect.top === nextRect.top &&
			rect.left === nextRect.left &&
			rect.width === nextRect.width &&
			rect.height === nextRect.height
		);
	});
}

function resolveFallbackRect(
	rect: AIContextualPromptAnchor["lastResolvedRect"],
): DOMRect | null {
	if (!rect) {
		return null;
	}
	return createDomRect(rect.top, rect.left, rect.width, rect.height);
}

function areRectsEqual(
	previous: AIContextualPromptAnchor["lastResolvedRect"],
	next: DOMRect,
): boolean {
	if (!previous) {
		return false;
	}
	return (
		previous.top === next.top &&
		previous.left === next.left &&
		previous.width === next.width &&
		previous.height === next.height
	);
}

function createDomRect(
	top: number,
	left: number,
	width: number,
	height: number,
): DOMRect {
	if (typeof DOMRect !== "undefined") {
		if (typeof DOMRect.fromRect === "function") {
			return DOMRect.fromRect({ x: left, y: top, width, height });
		}
		return new DOMRect(left, top, width, height);
	}
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
			return { top, left, width, height };
		},
	} as DOMRect;
}

function resolveInlineSessionTurnStatusLabel(
	status: string,
	pendingChangeCount: number,
	isTurnRunning: boolean,
): string {
	if (isTurnRunning || status === "streaming") {
		return "Working";
	}
	if (status === "accepted") {
		return "Accepted";
	}
	if (status === "rejected") {
		return "Rejected";
	}
	if (status === "error") {
		return "Error";
	}
	if (pendingChangeCount > 0) {
		return `${pendingChangeCount} pending`;
	}
	return "Done";
}

function resolveInlineSessionLabel(session: AISession): string {
	if (session.target.kind !== "selection") {
		return "Inline edit";
	}
	return session.target.selection.isMultiBlock ? "Selected range" : "Selected text";
}

function resolveInlineSessionTargetState(
	ownerDocument: Document,
	hostElement: HTMLElement | null,
	promptElement: HTMLElement | null,
	snapshot: AIContextualPromptAnchor["selectionSnapshot"],
): "active" | "pinned" {
	if (!snapshot) {
		return "active";
	}
	const activeElement = ownerDocument.activeElement;
	if (promptElement && activeElement instanceof Node && promptElement.contains(activeElement)) {
		return "active";
	}
	if (!hostElement) {
		return "pinned";
	}
	const domSelection = domSelectionToEditor(hostElement);
	if (!domSelection) {
		return "pinned";
	}
	return selectionMatchesSnapshot(domSelection, snapshot) ? "active" : "pinned";
}

function resolveInlineSessionTargetHint(
	targetState: "active" | "pinned",
): string {
	return targetState === "active"
		? "AI target is active"
		: "Pinned to the original selection";
}

function selectionMatchesSnapshot(
	selection:
		| {
			anchor: { blockId: string; offset: number };
			focus: { blockId: string; offset: number };
		}
		| null,
	snapshot: NonNullable<AIContextualPromptAnchor["selectionSnapshot"]>,
): boolean {
	if (!selection) {
		return false;
	}
	return (
		selection.anchor.blockId === snapshot.anchor.blockId &&
		selection.anchor.offset === snapshot.anchor.offset &&
		selection.focus.blockId === snapshot.focus.blockId &&
		selection.focus.offset === snapshot.focus.offset
	);
}

function mergeRefs<T>(
	...refs: Array<React.Ref<T> | React.MutableRefObject<T | null> | undefined>
): React.RefCallback<T> {
	return (value) => {
		for (const ref of refs) {
			if (!ref) {
				continue;
			}
			if (typeof ref === "function") {
				ref(value);
				continue;
			}
			ref.current = value;
		}
	};
}

function matchesShortcut(event: KeyboardEvent, shortcut: string): boolean {
	const parts = shortcut
		.toLowerCase()
		.split("+")
		.map((part) => part.trim())
		.filter(Boolean);
	const key = parts[parts.length - 1];
	const expectsMeta = parts.includes("mod")
		? navigator.platform.toLowerCase().includes("mac")
		: parts.includes("meta") || parts.includes("cmd");
	const expectsCtrl = parts.includes("mod")
		? !navigator.platform.toLowerCase().includes("mac")
		: parts.includes("ctrl");
	const expectsShift = parts.includes("shift");
	const expectsAlt = parts.includes("alt") || parts.includes("option");
	return (
		event.key.toLowerCase() === key &&
		event.metaKey === expectsMeta &&
		event.ctrlKey === expectsCtrl &&
		event.shiftKey === expectsShift &&
		event.altKey === expectsAlt
	);
}
