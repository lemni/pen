import type { Editor } from "@pen/types";
import type { AIAwarenessState } from "../types";

export function publishAwareness(
	editor: Editor,
	state: AIAwarenessState | null,
): void {
	const awareness = editor.internals.awareness;
	if (!awareness) return;

	const local = awareness.getLocalState() ?? {};
	if (!state) {
		const { ai: _omit, ...rest } = local as Record<string, unknown>;
		awareness.setLocalState(rest);
		return;
	}

	awareness.setLocalState({
		...local,
		ai: state,
	});
}
