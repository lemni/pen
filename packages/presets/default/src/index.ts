import { deltaStreamExtension } from "@pen/delta-stream";
import { documentOpsExtension } from "@pen/document-ops";
import {
	richTextShortcutsExtension,
	type RichTextShortcutsOptions,
} from "@pen/shortcuts";
import type { EditorPreset, Extension } from "@pen/types";
import { undoExtension } from "@pen/undo";

export interface DefaultPresetOptions {
	documentOps?: boolean;
	deltaStream?: boolean;
	undo?: boolean;
	shortcuts?: boolean | RichTextShortcutsOptions;
}

export function defaultPreset(
	options: DefaultPresetOptions = {},
): EditorPreset {
	return {
		resolve() {
			const extensions: Extension[] = [];

			if (options.documentOps !== false) {
				extensions.push(documentOpsExtension());
			}

			if (options.deltaStream !== false) {
				extensions.push(deltaStreamExtension());
			}

			if (options.undo !== false) {
				extensions.push(undoExtension());
			}

			const shortcutsOptions = resolveShortcutsOptions(options.shortcuts);
			if (shortcutsOptions) {
				extensions.push(richTextShortcutsExtension(shortcutsOptions));
			}

			return { extensions };
		},
	};
}

function resolveShortcutsOptions(
	shortcuts: DefaultPresetOptions["shortcuts"],
): RichTextShortcutsOptions | null {
	if (shortcuts === false) {
		return null;
	}

	if (shortcuts === true || shortcuts == null) {
		return {};
	}

	return shortcuts;
}
