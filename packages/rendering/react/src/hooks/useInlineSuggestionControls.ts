import React from "react";
import type { Editor } from "@pen/types";
import { useActiveAISession } from "./useActiveAISession";
import { useAIActions } from "./useAIActions";
import { useSuggestions } from "./useSuggestions";
import { querySuggestionAnchorElements } from "../utils/aiDomScope";

export interface InlineSuggestionControlPosition {
	id: string;
	action: "insert" | "delete" | "mixed";
	suggestionIds: readonly string[];
	host: HTMLElement;
	top: number;
	left: number;
	placement: "anchor" | "right-rail";
}

export interface InlineSuggestionControlsState {
	positions: readonly InlineSuggestionControlPosition[];
	activePosition: InlineSuggestionControlPosition | null;
	activeIndex: number;
	activeSuggestionNumber: number;
	visibleCount: number;
	hasVisibleControls: boolean;
	shouldUseRightEdgeRail: boolean;
	canGoToPrevious: boolean;
	canGoToNext: boolean;
	setActiveIndex: React.Dispatch<React.SetStateAction<number>>;
	goToPrevious: () => void;
	goToNext: () => void;
	acceptActiveSuggestionGroup: () => boolean;
	rejectActiveSuggestionGroup: () => boolean;
}

const SUGGESTION_CONTROL_VIEWPORT_PADDING = 8;
const SUGGESTION_CONTROL_WIDTH_ESTIMATE = 268;
const SUGGESTION_CONTROL_HEIGHT_ESTIMATE = 40;

export function useInlineSuggestionControls(
	editor: Editor,
): InlineSuggestionControlsState {
	const actions = useAIActions(editor);
	const suggestions = useSuggestions(editor);
	const activeSession = useActiveAISession(editor);

	const [positions, setPositions] = React.useState<
		readonly InlineSuggestionControlPosition[]
	>([]);
	const [activeIndex, setActiveIndex] = React.useState(0);
	const [resolvingSuggestionIds, setResolvingSuggestionIds] = React.useState<
		readonly string[]
	>([]);

	const activeInlineSessionTurn =
		activeSession?.surface === "inline-edit"
			? activeSession.turns[activeSession.turns.length - 1] ?? null
			: null;
	const shouldUseRightEdgeRail =
		activeSession?.surface === "inline-edit" &&
		activeSession.contextualPrompt?.composer.isOpen === true &&
		activeInlineSessionTurn != null;

	const sessionSuggestionIds = new Set(
		shouldUseRightEdgeRail && activeInlineSessionTurn
			? activeInlineSessionTurn.suggestionIds
			: (activeSession?.pendingSuggestionIds ?? []),
	);
	const resolvingSuggestionIdSet = React.useMemo(
		() => new Set(resolvingSuggestionIds),
		[resolvingSuggestionIds],
	);
	const scopedSuggestions = React.useMemo(
		() =>
			dedupeSuggestionsById(
				activeSession
					? suggestions.filter(
						(suggestion) =>
							(suggestion.sessionId === activeSession.id ||
								sessionSuggestionIds.has(suggestion.id)) &&
							!resolvingSuggestionIdSet.has(suggestion.id),
					)
					: suggestions.filter(
						(suggestion) => !resolvingSuggestionIdSet.has(suggestion.id),
					),
			),
		[activeSession, resolvingSuggestionIdSet, suggestions],
	);

	React.useEffect(() => {
		if (resolvingSuggestionIds.length === 0) {
			return;
		}
		const pendingSuggestionIds = new Set(suggestions.map((suggestion) => suggestion.id));
		setResolvingSuggestionIds((currentIds) =>
			currentIds.filter((suggestionId) => pendingSuggestionIds.has(suggestionId)),
		);
	}, [resolvingSuggestionIds.length, suggestions]);

	React.useLayoutEffect(() => {
		function updatePositions() {
			const nextPositions = resolveSuggestionControlPositions(editor, scopedSuggestions, {
				placement: shouldUseRightEdgeRail ? "right-rail" : "anchor",
			});
			setPositions((currentPositions) =>
				areSuggestionControlPositionsEqual(currentPositions, nextPositions)
					? currentPositions
					: nextPositions,
			);
		}

		updatePositions();
		window.addEventListener("resize", updatePositions);
		window.addEventListener("scroll", updatePositions, true);
		return () => {
			window.removeEventListener("resize", updatePositions);
			window.removeEventListener("scroll", updatePositions, true);
		};
	}, [editor, scopedSuggestions, shouldUseRightEdgeRail]);

	const activeGroupId =
		positions[activeIndex]?.id ??
		positions[positions.length - 1]?.id ??
		null;
	const activePosition = activeGroupId
		? positions.find((position) => position.id === activeGroupId) ?? null
		: null;
	const activeSuggestionNumber =
		activeGroupId == null
			? 0
			: positions.findIndex((position) => position.id === activeGroupId) + 1;
	const activeSuggestionScrollKey =
		activePosition == null
			? null
			: `${activePosition.id}:${activePosition.suggestionIds.join(",")}`;

	React.useEffect(() => {
		if (positions.length === 0) {
			setActiveIndex(0);
			return;
		}
		if (activeGroupId && positions.some((position) => position.id === activeGroupId)) {
			return;
		}
		setActiveIndex(positions.length - 1);
	}, [activeGroupId, positions]);

	React.useEffect(() => {
		if (!activePosition || !activeSuggestionScrollKey) {
			return;
		}
		const anchors = resolveSuggestionAnchorElements(editor, activePosition.suggestionIds);
		if (anchors.length === 0) {
			return;
		}
		scrollSuggestionIntoView(anchors);
	}, [activeSuggestionScrollKey, editor]);

	function goToPrevious() {
		setActiveIndex((currentIndex) => Math.max(0, currentIndex - 1));
	}

	function goToNext() {
		setActiveIndex((currentIndex) =>
			Math.min(positions.length - 1, currentIndex + 1),
		);
	}

	function acceptActiveSuggestionGroup(): boolean {
		if (!activePosition) {
			return false;
		}
		return (
			resolveSuggestionGroupOptimistically(
				setResolvingSuggestionIds,
				activePosition.suggestionIds,
				() => acceptSuggestionGroup(actions, activePosition.suggestionIds),
			).length > 0
		);
	}

	function rejectActiveSuggestionGroup(): boolean {
		if (!activePosition) {
			return false;
		}
		return (
			resolveSuggestionGroupOptimistically(
				setResolvingSuggestionIds,
				activePosition.suggestionIds,
				() => rejectSuggestionGroup(actions, activePosition.suggestionIds),
			).length > 0
		);
	}

	return {
		positions,
		activePosition,
		activeIndex,
		activeSuggestionNumber,
		visibleCount: positions.length,
		hasVisibleControls: activePosition != null,
		shouldUseRightEdgeRail,
		canGoToPrevious: activeSuggestionNumber > 1,
		canGoToNext: activeSuggestionNumber > 0 && activeSuggestionNumber < positions.length,
		setActiveIndex,
		goToPrevious,
		goToNext,
		acceptActiveSuggestionGroup,
		rejectActiveSuggestionGroup,
	};
}

function dedupeSuggestionsById<
	TSuggestion extends { id: string; action: "insert" | "delete" },
>(suggestions: readonly TSuggestion[]): readonly TSuggestion[] {
	const seenSuggestionIds = new Set<string>();
	const dedupedSuggestions: TSuggestion[] = [];
	for (const suggestion of suggestions) {
		if (seenSuggestionIds.has(suggestion.id)) {
			continue;
		}
		seenSuggestionIds.add(suggestion.id);
		dedupedSuggestions.push(suggestion);
	}
	return dedupedSuggestions;
}

function resolveSuggestionControlPositions(
	editor: Editor,
	suggestions: readonly { id: string; action: "insert" | "delete" }[],
	options?: { placement?: "anchor" | "right-rail" },
): readonly InlineSuggestionControlPosition[] {
	const visibleAnchors = resolveVisibleSuggestionAnchors(editor, suggestions);
	if (visibleAnchors.length === 0) {
		return [];
	}

	const groups: InlineSuggestionControlPosition[] = [];
	let currentGroup: SuggestionAnchor[] = [];

	for (const anchor of visibleAnchors) {
		const previousAnchor = currentGroup[currentGroup.length - 1];
		if (!previousAnchor || shouldGroupSuggestionAnchors(previousAnchor, anchor)) {
			currentGroup.push(anchor);
			continue;
		}
		const resolvedGroup = toSuggestionControlPosition(
			currentGroup,
			options?.placement ?? "anchor",
		);
		if (resolvedGroup) {
			groups.push(resolvedGroup);
		}
		currentGroup = [anchor];
	}

	const trailingGroup = toSuggestionControlPosition(
		currentGroup,
		options?.placement ?? "anchor",
	);
	if (trailingGroup) {
		groups.push(trailingGroup);
	}

	return groups;
}

function resolveSuggestionAnchorElements(
	editor: Editor,
	suggestionIds: readonly string[],
): HTMLElement[] {
	if (suggestionIds.length === 0) {
		return [];
	}
	const suggestionIdSet = new Set(suggestionIds);
	return querySuggestionAnchorElements(editor)
		.filter((element) => {
			if (!isRenderableSuggestionAnchor(element)) {
				return false;
			}
			const suggestionId = element.dataset.suggestionId;
			return suggestionId ? suggestionIdSet.has(suggestionId) : false;
		});
}

function scrollSuggestionIntoView(suggestionElements: readonly HTMLElement[]): void {
	const firstVisibleElement = suggestionElements.find((suggestionElement) => {
		const rect = suggestionElement.getBoundingClientRect();
		return rect.width > 0 || rect.height > 0;
	});
	if (!firstVisibleElement) {
		return;
	}

	const scrollContainer = findNearestScrollContainer(firstVisibleElement);
	if (!scrollContainer) {
		if (typeof firstVisibleElement.scrollIntoView === "function") {
			firstVisibleElement.scrollIntoView({
				block: "nearest",
				inline: "nearest",
			});
		}
		return;
	}

	const containerRect = scrollContainer.getBoundingClientRect();
	const elementRect = firstVisibleElement.getBoundingClientRect();
	const topPadding = 96;
	const bottomPadding = 180;

	if (elementRect.top < containerRect.top + topPadding) {
		const nextTop =
			scrollContainer.scrollTop -
			(containerRect.top + topPadding - elementRect.top);
		setScrollContainerTop(scrollContainer, nextTop);
		return;
	}

	if (elementRect.bottom > containerRect.bottom - bottomPadding) {
		const nextTop =
			scrollContainer.scrollTop +
			(elementRect.bottom - (containerRect.bottom - bottomPadding));
		setScrollContainerTop(scrollContainer, nextTop);
	}
}

function setScrollContainerTop(
	scrollContainer: HTMLElement,
	nextTop: number,
): void {
	scrollContainer.scrollTop = nextTop;
}

function findNearestScrollContainer(element: HTMLElement): HTMLElement | null {
	let currentElement = element.parentElement;
	while (currentElement) {
		const computedStyle = window.getComputedStyle(currentElement);
		const canScrollY =
			(computedStyle.overflowY === "auto" ||
				computedStyle.overflowY === "scroll") &&
			currentElement.scrollHeight > currentElement.clientHeight;
		if (canScrollY) {
			return currentElement;
		}
		currentElement = currentElement.parentElement;
	}
	const editorContent = element.closest("[data-pen-editor-content]");
	if (editorContent?.parentElement) {
		return editorContent.parentElement;
	}
	return element.parentElement;
}

function resolveSuggestionControlHost(
	element: HTMLElement,
	scrollContainer: HTMLElement,
): HTMLElement {
	const editorContent = element.closest("[data-pen-editor-content]");
	if (editorContent instanceof HTMLElement) {
		return editorContent;
	}
	return scrollContainer;
}

interface SuggestionAnchor {
	suggestionId: string;
	action: "insert" | "delete";
	blockId: string | null;
	blockElement: HTMLElement | null;
	element: HTMLElement;
	rect: DOMRect;
}

function resolveVisibleSuggestionAnchors(
	editor: Editor,
	suggestions: readonly { id: string; action: "insert" | "delete" }[],
): readonly SuggestionAnchor[] {
	const suggestionActions = new Map(
		suggestions.map((suggestion) => [suggestion.id, suggestion.action]),
	);
	return querySuggestionAnchorElements(editor)
		.flatMap((element) => {
			if (!isRenderableSuggestionAnchor(element)) {
				return [];
			}
			const suggestionId = element.dataset.suggestionId;
			if (!suggestionId) {
				return [];
			}
			const action = suggestionActions.get(suggestionId);
			if (!action) {
				return [];
			}
			const rect = element.getBoundingClientRect();
			if (rect.width === 0 && rect.height === 0) {
				return [];
			}
			return [{
				suggestionId,
				action,
				blockId: element.closest("[data-block-id]")?.getAttribute("data-block-id") ?? null,
				blockElement: element.closest("[data-pen-editor-block]"),
				element,
				rect,
			}];
		});
}

function isRenderableSuggestionAnchor(element: HTMLElement): boolean {
	return !element.hasAttribute("data-pen-ai-inline-suggestion-control");
}

function shouldGroupSuggestionAnchors(
	previousAnchor: SuggestionAnchor,
	nextAnchor: SuggestionAnchor,
): boolean {
	return (
		previousAnchor.blockId === nextAnchor.blockId ||
		areAdjacentSuggestionBlocks(previousAnchor, nextAnchor)
	);
}

function areAdjacentSuggestionBlocks(
	previousAnchor: SuggestionAnchor,
	nextAnchor: SuggestionAnchor,
): boolean {
	const previousBlock = previousAnchor.blockElement;
	const nextBlock = nextAnchor.blockElement;
	if (!previousBlock || !nextBlock || previousBlock === nextBlock) {
		return false;
	}
	const blocksHost = previousBlock.parentElement;
	if (!blocksHost || blocksHost !== nextBlock.parentElement) {
		return false;
	}
	const blockElements = [...blocksHost.querySelectorAll<HTMLElement>("[data-pen-editor-block]")];
	const previousIndex = blockElements.indexOf(previousBlock);
	const nextIndex = blockElements.indexOf(nextBlock);
	if (previousIndex < 0 || nextIndex < 0) {
		return false;
	}
	return nextIndex === previousIndex + 1;
}

function toSuggestionControlPosition(
	anchors: readonly SuggestionAnchor[],
	placement: "anchor" | "right-rail",
): InlineSuggestionControlPosition | null {
	if (anchors.length === 0) {
		return null;
	}
	if (!hasMeaningfulSuggestionContent(anchors)) {
		return null;
	}
	const bottom = Math.max(...anchors.map((anchor) => anchor.rect.bottom));
	const scrollContainer = findNearestScrollContainer(anchors[0]!.element);
	if (!scrollContainer) {
		return null;
	}
	const host = resolveSuggestionControlHost(anchors[0]!.element, scrollContainer);
	const hostRect = host.getBoundingClientRect();
	const suggestionIds = dedupeSuggestionIds(
		anchors.map((anchor) => anchor.suggestionId),
	);
	const groupActions = new Set(anchors.map((anchor) => anchor.action));
	return {
		id: suggestionIds[0] ?? anchors[0]!.suggestionId,
		action: groupActions.size > 1 ? "mixed" : anchors[0]!.action,
		suggestionIds,
		host,
		top: clampSuggestionControlTop(
			bottom - hostRect.top + 8,
			host,
		),
		left: clampSuggestionControlLeft(host),
		placement,
	};
}

function hasMeaningfulSuggestionContent(
	anchors: readonly SuggestionAnchor[],
): boolean {
	return anchors.some((anchor) => (anchor.element.textContent ?? "").trim().length > 0);
}

function dedupeSuggestionIds(suggestionIds: readonly string[]): readonly string[] {
	return [...new Set(suggestionIds)];
}

function clampSuggestionControlLeft(host: HTMLElement): number {
	const minLeft = SUGGESTION_CONTROL_VIEWPORT_PADDING;
	const maxLeft =
		host.clientWidth -
		SUGGESTION_CONTROL_WIDTH_ESTIMATE -
		SUGGESTION_CONTROL_VIEWPORT_PADDING;
	return Math.max(minLeft, maxLeft);
}

function clampSuggestionControlTop(
	preferredTop: number,
	host: HTMLElement,
): number {
	const minTop = SUGGESTION_CONTROL_VIEWPORT_PADDING;
	const maxTop =
		host.clientHeight -
		SUGGESTION_CONTROL_HEIGHT_ESTIMATE -
		SUGGESTION_CONTROL_VIEWPORT_PADDING;
	return Math.max(
		minTop,
		Math.min(preferredTop, maxTop),
	);
}

function areSuggestionControlPositionsEqual(
	previous: readonly InlineSuggestionControlPosition[],
	next: readonly InlineSuggestionControlPosition[],
): boolean {
	if (previous.length !== next.length) {
		return false;
	}
	for (let index = 0; index < previous.length; index += 1) {
		const previousPosition = previous[index];
		const nextPosition = next[index];
		if (
			!previousPosition ||
			!nextPosition ||
			previousPosition.id !== nextPosition.id ||
			previousPosition.action !== nextPosition.action ||
			previousPosition.host !== nextPosition.host ||
			previousPosition.placement !== nextPosition.placement ||
			previousPosition.suggestionIds.length !== nextPosition.suggestionIds.length ||
			previousPosition.suggestionIds.some(
				(suggestionId, suggestionIndex) =>
					suggestionId !== nextPosition.suggestionIds[suggestionIndex],
			) ||
			previousPosition.top !== nextPosition.top ||
			previousPosition.left !== nextPosition.left
		) {
			return false;
		}
	}
	return true;
}

function acceptSuggestionGroup(
	actions: ReturnType<typeof useAIActions>,
	suggestionIds: readonly string[],
): readonly string[] {
	const acceptedSuggestionIds: string[] = [];
	for (const suggestionId of suggestionIds) {
		if (actions.acceptSuggestion(suggestionId)) {
			acceptedSuggestionIds.push(suggestionId);
		}
	}
	return acceptedSuggestionIds;
}

function rejectSuggestionGroup(
	actions: ReturnType<typeof useAIActions>,
	suggestionIds: readonly string[],
): readonly string[] {
	const rejectedSuggestionIds: string[] = [];
	for (const suggestionId of suggestionIds) {
		if (actions.rejectSuggestion(suggestionId)) {
			rejectedSuggestionIds.push(suggestionId);
		}
	}
	return rejectedSuggestionIds;
}

function resolveSuggestionGroupOptimistically(
	setResolvingSuggestionIds: React.Dispatch<React.SetStateAction<readonly string[]>>,
	suggestionIds: readonly string[],
	resolveSuggestionGroup: () => readonly string[],
): readonly string[] {
	setResolvingSuggestionIds((currentIds) => [
		...currentIds,
		...suggestionIds.filter((suggestionId) => !currentIds.includes(suggestionId)),
	]);
	const resolvedSuggestionIds = resolveSuggestionGroup();
	if (resolvedSuggestionIds.length === suggestionIds.length) {
		return resolvedSuggestionIds;
	}
	const resolvedSuggestionIdSet = new Set(resolvedSuggestionIds);
	const unresolvedSuggestionIds = suggestionIds.filter(
		(suggestionId) => !resolvedSuggestionIdSet.has(suggestionId),
	);
	if (unresolvedSuggestionIds.length > 0) {
		setResolvingSuggestionIds((currentIds) =>
			currentIds.filter(
				(suggestionId) => !unresolvedSuggestionIds.includes(suggestionId),
			),
		);
	}
	return resolvedSuggestionIds;
}
