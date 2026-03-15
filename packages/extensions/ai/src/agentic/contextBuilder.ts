import type {
	Editor,
	PenStreamPart,
	ToolContext,
} from "@pen/types";
import { ToolContextImpl } from "@pen/document-ops";

export function buildToolContext(
	editor: Editor,
	_zoneId: string,
	_blockId: string,
	_streamingTarget: unknown,
	onEmit?: (part: PenStreamPart) => void,
): ToolContext {
	return new ToolContextImpl(editor, "default", (part) => {
		onEmit?.(part);
	});
}
