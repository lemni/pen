import type { Editor } from "@pen/types";
import { DATA_ATTRS } from "./dataAttributes";

export function shouldIgnoreAIKeyboardEvent(
	editor: Editor,
	event: KeyboardEvent,
): boolean {
	const eventElement = resolveEventElement(event.target);
	const editorRoot = resolveEditorRootForAI(editor);

	if (editorRoot && eventElement && !editorRoot.contains(eventElement)) {
		return true;
	}

	if (
		eventElement instanceof HTMLInputElement ||
		eventElement instanceof HTMLTextAreaElement ||
		eventElement instanceof HTMLSelectElement
	) {
		return true;
	}

	return eventElement?.isContentEditable === true && !editorRoot?.contains(eventElement);
}

function resolveEditorRootForAI(editor: Editor): HTMLElement | null {
	const selection = editor.getSelection();
	const activeBlockId =
		selection?.type === "text"
			? selection.focus.blockId
			: selection?.type === "block"
				? (selection.blockIds[0] ?? null)
				: selection?.type === "cell"
					? selection.blockId
					: null;

	if (activeBlockId) {
		const activeBlock = document.querySelector<HTMLElement>(
			`[${DATA_ATTRS.blockId}="${escapeForAttributeSelector(activeBlockId)}"]`,
		);
		const activeRoot = activeBlock?.closest(`[${DATA_ATTRS.editorRoot}]`);
		if (activeRoot instanceof HTMLElement) {
			return activeRoot;
		}
	}

	const roots = document.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.editorRoot}]`);
	return roots.length === 1 ? roots[0] : null;
}

function resolveEventElement(target: EventTarget | null): HTMLElement | null {
	if (target instanceof HTMLElement) {
		return target;
	}
	if (target instanceof Node) {
		return target.parentElement;
	}
	return null;
}

function escapeForAttributeSelector(value: string): string {
	return typeof CSS !== "undefined" && CSS.escape
		? CSS.escape(value)
		: value.replace(/(["\\\]])/g, "\\$1");
}
