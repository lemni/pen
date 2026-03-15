import type { DocumentOp, Editor } from "@pen/types";

export type FieldEditorDelta = {
	retain?: number;
	insert?: string | Record<string, unknown>;
	delete?: number;
	attributes?: Record<string, unknown>;
};

export type FieldEditorTextLike = {
	length: number;
	toString(): string;
	insert(offset: number, text: string): void;
	delete(offset: number, length: number): void;
	observe(callback: (event: FieldEditorTextChangeEvent) => void): unknown;
	unobserve(callback: unknown): void;
	toDelta(): FieldEditorDelta[];
};

export type FieldEditorTextChangeEvent = {
	delta: FieldEditorDelta[];
	transaction?: {
		origin?: unknown;
	};
};

export type FieldEditorObserver = (event: FieldEditorTextChangeEvent) => void;

export type InlineInputRuleEngine = {
	tryMatchInline(
		editor: Editor,
		blockId: string,
		insertedText: string,
		options?: { offset?: number },
	): DocumentOp[] | null;
};
