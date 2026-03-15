import {
	INLINE_COMPLETION_SLOT,
	type Decoration,
	type Editor,
	type InlineCompletionController,
	type InlineCompletionState,
	type InlineCompletionSuggestion,
} from "@pen/types";

class InlineCompletionControllerImpl implements InlineCompletionController {
	private _state: InlineCompletionState = {
		visibleSuggestion: null,
	};
	private readonly _listeners = new Set<() => void>();

	constructor(private readonly _editor: Editor) { }

	getState(): InlineCompletionState {
		return {
			visibleSuggestion: this._state.visibleSuggestion,
		};
	}

	subscribe(listener: () => void): () => void {
		this._listeners.add(listener);
		return () => this._listeners.delete(listener);
	}

	showSuggestion(suggestion: InlineCompletionSuggestion): void {
		this._state = {
			visibleSuggestion: suggestion,
		};
		this._emit();
	}

	dismissSuggestion(): void {
		if (!this._state.visibleSuggestion) {
			return;
		}
		this._state = {
			visibleSuggestion: null,
		};
		this._emit();
	}

	acceptSuggestion(): boolean {
		const suggestion = this._state.visibleSuggestion;
		if (!suggestion) {
			return false;
		}

		this._state = {
			visibleSuggestion: null,
		};

		if (suggestion.type === "inline") {
			this._editor.apply(
				[{
					type: "insert-text",
					blockId: suggestion.blockId,
					offset: suggestion.offset,
					text: suggestion.text,
				}],
				{ origin: "ai", undoGroup: true },
			);
			this._emit();
			return true;
		}

		const blockId = crypto.randomUUID();
		this._editor.apply(
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
		this._emit();
		return true;
	}

	hasVisibleSuggestion(): boolean {
		return this._state.visibleSuggestion !== null;
	}

	buildDecorations(): readonly Decoration[] {
		const suggestion = this._state.visibleSuggestion;
		if (!suggestion || suggestion.type !== "inline") {
			return [];
		}
		const anchor = resolveInlineSuggestionAnchor(this._editor, suggestion);
		if (!anchor) {
			return [];
		}
		return [{
			type: "inline",
			blockId: suggestion.blockId,
			from: anchor.from,
			to: anchor.to,
			attributes: {
				class: "pen-ephemeral-suggestion",
				"data-suggestion-id": suggestion.id,
				"data-suggestion-text": suggestion.text,
				"data-suggestion-type": suggestion.type,
				"data-suggestion-placement": anchor.placement,
			},
		}];
	}

	destroy(): void {
		this._state = {
			visibleSuggestion: null,
		};
		this._listeners.clear();
	}

	private _emit(): void {
		this._editor.requestDecorationUpdate();
		for (const listener of this._listeners) {
			listener();
		}
	}
}

export function getInlineCompletionController(
	editor: Editor,
): InlineCompletionController | null {
	return editor.internals.getSlot<InlineCompletionController>(
		INLINE_COMPLETION_SLOT,
	) ?? null;
}

export function ensureInlineCompletionController(
	editor: Editor,
): { controller: InlineCompletionController; isOwner: boolean } {
	const existingController = getInlineCompletionController(editor);
	if (existingController) {
		return {
			controller: existingController,
			isOwner: false,
		};
	}

	const controller = new InlineCompletionControllerImpl(editor);
	editor.internals.setSlot(INLINE_COMPLETION_SLOT, controller);
	return {
		controller,
		isOwner: true,
	};
}

function resolveInlineSuggestionAnchor(
	editor: Editor,
	suggestion: InlineCompletionSuggestion,
): { from: number; to: number; placement: "before" | "after" } | null {
	const blockTextLength = editor.getBlock(suggestion.blockId)?.textContent().length ?? 0;
	if (blockTextLength <= 0) {
		return null;
	}
	if (suggestion.offset <= 0) {
		return {
			from: 0,
			to: 1,
			placement: "before",
		};
	}
	if (suggestion.offset >= blockTextLength) {
		return {
			from: blockTextLength - 1,
			to: blockTextLength,
			placement: "after",
		};
	}
	return {
		from: suggestion.offset,
		to: suggestion.offset + 1,
		placement: "before",
	};
}
