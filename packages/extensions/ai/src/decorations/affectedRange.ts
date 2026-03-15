import type { Decoration, Editor, InlineDecoration } from "@pen/types";
import type { AISession, AISessionSelectionSnapshot } from "../types";

const AFFECTED_RANGE_CLASS = "pen-ai-affected-range";
const AFFECTED_RANGE_STYLE = [
	"background: color-mix(in srgb, #2563eb 26%, transparent)",
	"box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.72), inset 0 -1px 0 rgba(147, 197, 253, 0.92)",
	"border-radius: 4px",
	"box-decoration-break: clone",
	"-webkit-box-decoration-break: clone",
].join("; ");

export function buildAffectedRangeDecorations(
	editor: Editor,
	sessions: readonly AISession[],
	activeSessionId: string | null | undefined,
): Decoration[] {
	const activeSession =
		sessions.find((session) => session.id === activeSessionId) ?? null;
	if (
		!activeSession ||
		activeSession.surface !== "inline-edit" ||
		!activeSession.contextualPrompt?.composer.isOpen
	) {
		return [];
	}
	const selectionSnapshot = resolveAffectedRangeSelection(activeSession);
	if (!selectionSnapshot) {
		return [];
	}
	return buildSelectionSnapshotDecorations(editor, selectionSnapshot);
}

function resolveAffectedRangeSelection(
	session: AISession,
): AISessionSelectionSnapshot | null {
	const activeTurn =
		session.activeTurnId != null
			? session.turns.find((turn) => turn.id === session.activeTurnId) ?? null
			: session.turns[session.turns.length - 1] ?? null;
	return (
		activeTurn?.selection ??
		session.contextualPrompt?.anchor.selectionSnapshot ??
		(session.target.kind === "selection"
			? {
				anchor: { ...session.target.selection.anchor },
				focus: { ...session.target.selection.focus },
				blockRange: [...session.target.selection.blockRange],
				isMultiBlock: session.target.selection.isMultiBlock,
			}
			: null)
	);
}

function buildSelectionSnapshotDecorations(
	editor: Editor,
	selectionSnapshot: AISessionSelectionSnapshot,
): Decoration[] {
	const decorations: Decoration[] = [];
	const blockRange =
		selectionSnapshot.blockRange.length > 0
			? selectionSnapshot.blockRange
			: [selectionSnapshot.anchor.blockId];
	const firstBlockId = blockRange[0] ?? null;
	const lastBlockId = blockRange[blockRange.length - 1] ?? firstBlockId;
	if (!firstBlockId || !lastBlockId) {
		return decorations;
	}

	for (const blockId of blockRange) {
		const block = editor.getBlock(blockId);
		if (!block) {
			continue;
		}
		const isSingleBlock = firstBlockId === lastBlockId;
		const blockTextLength = block.textContent({ resolved: true }).length;
		const from = isSingleBlock
			? Math.min(selectionSnapshot.anchor.offset, selectionSnapshot.focus.offset)
			: blockId === firstBlockId
				? resolveBoundaryOffset(selectionSnapshot, firstBlockId)
				: 0;
		const to = isSingleBlock
			? Math.max(selectionSnapshot.anchor.offset, selectionSnapshot.focus.offset)
			: blockId === lastBlockId
				? resolveBoundaryOffset(selectionSnapshot, lastBlockId)
				: blockTextLength;
		if (to <= from) {
			continue;
		}
		const decoration: InlineDecoration = {
			type: "inline",
			blockId,
			from,
			to,
			key: `ai-affected-range:${blockId}:${from}:${to}`,
			attributes: {
				class: AFFECTED_RANGE_CLASS,
				"data-ai-affected-range": "",
				"data-ai-affected-range-session": "",
				style: AFFECTED_RANGE_STYLE,
			},
		};
		decorations.push(decoration);
	}

	return decorations;
}

function resolveBoundaryOffset(
	selectionSnapshot: AISessionSelectionSnapshot,
	blockId: string,
): number {
	if (selectionSnapshot.anchor.blockId === blockId) {
		return selectionSnapshot.anchor.offset;
	}
	return selectionSnapshot.focus.offset;
}
