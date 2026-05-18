import { DATA_ATTRS } from "./dataAttributes";

export function fieldEditorTextEntryAttrs(isActive: boolean): Record<string, unknown> {
	return {
		[DATA_ATTRS.fieldEditorActiveSurface]: isActive ? "" : undefined,
		role: isActive ? "textbox" : undefined,
		"aria-multiline": isActive ? true : undefined,
	};
}
