import { defineExtension, type Extension, type KeyBinding } from "@pen/types";
import { toggleInlineMark, setInlineMark } from "./toggleInlineMark.js";

export const RICH_TEXT_SHORTCUTS_EXTENSION_NAME = "rich-text-shortcuts";

type ShortcutMark = "bold" | "italic" | "underline";

export interface RichTextShortcutsOptions {
	bindings?: Partial<Record<ShortcutMark, readonly string[] | null>>;
	onToggleLink?: (editor: Parameters<typeof setInlineMark>[0]) => boolean;
}

const DEFAULT_BINDINGS: Record<ShortcutMark, readonly string[]> = {
	bold: ["Mod-b"],
	italic: ["Mod-i"],
	underline: ["Mod-u"],
};

const BINDING_DESCRIPTIONS: Record<ShortcutMark, string> = {
	bold: "Toggle bold formatting",
	italic: "Toggle italic formatting",
	underline: "Toggle underline formatting",
};

export function richTextShortcutsExtension(
	options: RichTextShortcutsOptions = {},
): Extension {
	return defineExtension({
		name: RICH_TEXT_SHORTCUTS_EXTENSION_NAME,
		keyBindings: buildKeyBindings(options),
	});
}

function buildKeyBindings(
	options: RichTextShortcutsOptions,
): readonly KeyBinding[] {
	const configuredBindings = {
		...DEFAULT_BINDINGS,
		...options.bindings,
	};
	const keyBindings: KeyBinding[] = [];

	for (const markType of Object.keys(DEFAULT_BINDINGS) as ShortcutMark[]) {
		const keys = configuredBindings[markType];
		if (!keys || keys.length === 0) continue;

		for (const key of keys) {
			keyBindings.push({
				key,
				priority: 100,
				description: BINDING_DESCRIPTIONS[markType],
				handler: (editor) => toggleInlineMark(editor, markType),
			});
		}
	}

	if (options.onToggleLink) {
		const onToggleLink = options.onToggleLink;
		keyBindings.push({
			key: "Mod-k",
			priority: 100,
			description: "Toggle link",
			handler: (editor) => onToggleLink(editor),
		});
	}

	return keyBindings;
}
