import type { Editor } from "@pen/types";
import {
	getAIController,
	type AICommandExecutionOptions,
	type AISession,
	type AISessionResolution,
	type AISurface,
} from "@pen/ai";

export function useAIActions(editor: Editor): {
	runPrompt: (prompt: string, options?: AICommandExecutionOptions) => Promise<unknown>;
	acceptSuggestion: (id: string) => boolean;
	rejectSuggestion: (id: string) => boolean;
	acceptAllSuggestions: () => void;
	rejectAllSuggestions: () => void;
	acceptActiveGeneration: () => boolean;
	acceptReviewItem: (id: string) => boolean;
	rejectReviewItem: (id: string) => boolean;
	acceptReviewItems: (ids: readonly string[]) => boolean;
	rejectReviewItems: (ids: readonly string[]) => boolean;
	retryActiveGeneration: () => Promise<unknown>;
	openCommandMenu: () => void;
	closeCommandMenu: () => void;
	startSession: (input: {
		surface: AISurface;
		target?: "auto" | "selection" | "block" | "document";
	}) => AISession | null;
	openContextualPrompt: (input?: {
		surface?: Extract<AISurface, "inline-edit">;
		target?: "auto" | "selection" | "block" | "document";
	}) => AISession | null;
	runSessionPrompt: (
		sessionId: string,
		prompt: string,
		options?: AICommandExecutionOptions,
	) => Promise<unknown>;
	resolveSessionTurn: (
		sessionId: string,
		turnId: string,
		resolution: AISessionResolution,
	) => boolean;
	resolveSession: (sessionId: string, resolution: AISessionResolution) => boolean;
	acceptSession: (sessionId: string) => boolean;
	rejectSession: (sessionId: string) => boolean;
	cancelSession: (sessionId: string) => void;
} {
	const controller = getAIController(editor);

	return {
		runPrompt(prompt: string, options?: AICommandExecutionOptions) {
			if (!controller) {
				return Promise.resolve(null);
			}
			return controller.runPrompt(prompt, options);
		},
		acceptSuggestion(id: string) {
			return controller?.acceptSuggestion(id) ?? false;
		},
		rejectSuggestion(id: string) {
			return controller?.rejectSuggestion(id) ?? false;
		},
		acceptAllSuggestions() {
			controller?.acceptAllSuggestions();
		},
		rejectAllSuggestions() {
			controller?.rejectAllSuggestions();
		},
		acceptActiveGeneration() {
			return controller?.acceptActiveGeneration() ?? false;
		},
		acceptReviewItem(id: string) {
			return controller?.acceptReviewItem(id) ?? false;
		},
		rejectReviewItem(id: string) {
			return controller?.rejectReviewItem(id) ?? false;
		},
		acceptReviewItems(ids: readonly string[]) {
			return controller?.acceptReviewItems(ids) ?? false;
		},
		rejectReviewItems(ids: readonly string[]) {
			return controller?.rejectReviewItems(ids) ?? false;
		},
		retryActiveGeneration() {
			if (!controller) {
				return Promise.resolve(null);
			}
			return controller.retryActiveGeneration();
		},
		openCommandMenu() {
			controller?.openCommandMenu();
		},
		closeCommandMenu() {
			controller?.closeCommandMenu();
		},
		startSession(input) {
			return controller?.startSession(input) ?? null;
		},
		openContextualPrompt(input) {
			return controller?.openContextualPrompt(input) ?? null;
		},
		runSessionPrompt(sessionId, prompt, options) {
			if (!controller) {
				return Promise.resolve(null);
			}
			return controller.runSessionPrompt(sessionId, prompt, options);
		},
		resolveSessionTurn(sessionId, turnId, resolution) {
			return controller?.resolveSessionTurn(sessionId, turnId, resolution) ?? false;
		},
		resolveSession(sessionId, resolution) {
			return controller?.resolveSession(sessionId, resolution) ?? false;
		},
		acceptSession(sessionId) {
			return controller?.acceptSession(sessionId) ?? false;
		},
		rejectSession(sessionId) {
			return controller?.rejectSession(sessionId) ?? false;
		},
		cancelSession(sessionId) {
			controller?.cancelSession(sessionId);
		},
	};
}
