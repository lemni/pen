import type { Editor, InlineDecoration } from "@pen/types";
import type { EphemeralSuggestion } from "../types";

export class EphemeralSuggestionManager {
	private _current: EphemeralSuggestion | null = null;
	private readonly _listeners = new Set<() => void>();

	get current(): EphemeralSuggestion | null {
		return this._current;
	}

	show(suggestion: EphemeralSuggestion): void {
		this._current = suggestion;
		this._notify();
	}

	dismiss(): void {
		if (!this._current) return;
		this._current = null;
		this._notify();
	}

	accept(editor: Editor): void {
		const suggestion = this._current;
		if (!suggestion) return;
		this._current = null;

		if (suggestion.type === "inline") {
			editor.apply(
				[{
					type: "insert-text",
					blockId: suggestion.blockId,
					offset: suggestion.offset,
					text: suggestion.text,
				}],
				{ origin: "ai", undoGroup: true },
			);
			this._notify();
			return;
		}

		const blockId = crypto.randomUUID();
		editor.apply(
			[
				{
					type: "insert-block",
					blockId,
					blockType: suggestion.blockType ?? "paragraph",
					props: suggestion.props ?? {},
					position: { after: suggestion.blockId },
				},
				{
					type: "insert-text",
					blockId,
					offset: 0,
					text: suggestion.text,
				},
			],
			{ origin: "ai", undoGroup: true },
		);
		this._notify();
	}

	toDecorations(): InlineDecoration[] {
		const suggestion = this._current;
		if (!suggestion || suggestion.type !== "inline") return [];
		return [{
			type: "inline",
			blockId: suggestion.blockId,
			from: suggestion.offset,
			to: suggestion.offset + 1,
			attributes: {
				class: "pen-ephemeral-suggestion",
				"data-suggestion-id": suggestion.id,
				"data-suggestion-text": suggestion.text,
				"data-suggestion-type": suggestion.type,
			},
		}];
	}

	subscribe(listener: () => void): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	private _notify(): void {
		for (const listener of this._listeners) {
			listener();
		}
	}
}
