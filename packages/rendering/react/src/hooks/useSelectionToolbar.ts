import { useRef, useState, useEffect } from "react";
import type { Editor } from "@pen/types";
import { getAIController } from "@pen/ai";
import { DATA_ATTRS } from "../utils/dataAttributes";
import { queryBlockElement } from "../field-editor/selectionBridge";
import { resolveSelectionRect } from "../selection/placement";
import { useSyncExternalStoreWithSelector } from "../utils/useSyncExternalStoreWithSelector";

export interface SelectionToolbarState {
	isOpen: boolean;
	selectionRect: DOMRect | null;
}

const CLOSED_STATE: SelectionToolbarState = {
	isOpen: false,
	selectionRect: null,
};

/**
 * Tracks whether the editor has a non-collapsed text selection and
 * provides the native DOM rect of that selection for positioning a
 * floating toolbar.
 *
 * The rect prefers the native DOM range, but falls back to canonical
 * editor selection geometry so multi-block interactions stay anchored
 * even if the browser selection is transient.
 */
export function useSelectionToolbar(editor: Editor): SelectionToolbarState {
	const [state, setState] = useState<SelectionToolbarState>(CLOSED_STATE);
	const rafRef = useRef(0);
	const controller = getAIController(editor);
	const isInlinePromptOpen = useSyncExternalStoreWithSelector(
		(callback) => {
			if (!controller) {
				return () => { };
			}
			return controller.subscribeSessions(callback);
		},
		() => controller?.getState() ?? null,
		() => null,
		(aiState) => {
			const activeSession =
				aiState?.sessions.find(
					(session) => session.id === aiState.activeSessionId,
				) ?? null;
			return (
				activeSession?.surface === "inline-edit" &&
				activeSession.contextualPrompt?.composer.isOpen === true &&
				activeSession.status !== "cancelled"
			);
		},
	);

	useEffect(() => {
		const update = () => {
			cancelAnimationFrame(rafRef.current);
			rafRef.current = requestAnimationFrame(() => {
				if (isInlinePromptOpen) {
					setState(CLOSED_STATE);
					return;
				}

				const selection = editor.selection;
				if (
					!selection ||
					selection.type !== "text" ||
					selection.isCollapsed
				) {
					setState(CLOSED_STATE);
					return;
				}

				const nativeRect = resolveNativeSelectionRect();
				if (nativeRect) {
					setState({ isOpen: true, selectionRect: nativeRect });
					return;
				}

				const root = resolveEditorRoot(editor, selection);
				if (!root) {
					setState(CLOSED_STATE);
					return;
				}

				const rect = resolveSelectionRect(root, selection);
				if (!rect || (rect.width === 0 && rect.height === 0)) {
					setState(CLOSED_STATE);
					return;
				}

				setState({ isOpen: true, selectionRect: rect });
			});
		};

		const unsubs = [
			editor.on("selectionChange", update),
			editor.onDocumentCommit(update),
		];
		window.addEventListener("resize", update);
		window.addEventListener("scroll", update, true);

		update();

		return () => {
			cancelAnimationFrame(rafRef.current);
			window.removeEventListener("resize", update);
			window.removeEventListener("scroll", update, true);
			unsubs.forEach((u) => u());
		};
	}, [editor, isInlinePromptOpen]);

	return state;
}

function resolveNativeSelectionRect(): DOMRect | null {
	const selection = window.getSelection();
	if (!selection || selection.rangeCount === 0) {
		return null;
	}

	const rect = selection.getRangeAt(0).getBoundingClientRect();
	if (rect.width === 0 && rect.height === 0) {
		return null;
	}

	return rect;
}

function resolveEditorRoot(
	editor: Editor,
	selection: Editor["selection"],
): HTMLElement | null {
	if (selection?.type === "text") {
		const roots = document.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.editorRoot}]`);
		for (const root of roots) {
			if (queryBlockElement(root, selection.anchor.blockId)) {
				return root;
			}
		}
	}

	const domSelection = window.getSelection();
	const selectionRoot = resolveNodeRoot(domSelection?.anchorNode);
	if (selectionRoot) {
		return selectionRoot;
	}

	const activeRoot = resolveNodeRoot(document.activeElement);
	if (activeRoot) {
		return activeRoot;
	}

	const roots = document.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.editorRoot}]`);
	return roots.length === 1 ? roots[0] : null;
}

function resolveNodeRoot(node: Node | null | undefined): HTMLElement | null {
	if (!node) {
		return null;
	}

	if (node instanceof HTMLElement) {
		return node.closest(`[${DATA_ATTRS.editorRoot}]`);
	}

	return node.parentElement?.closest(`[${DATA_ATTRS.editorRoot}]`) ?? null;
}
