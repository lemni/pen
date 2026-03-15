import type { Editor } from "@pen/types";
import type {
	AICommandExecutionOptions,
	AISession,
	AISessionResolution,
	AISurface,
	GenerationState,
} from "@pen/ai";
import { getAIController } from "@pen/ai";

export function useAISessionActions(editor: Editor): {
	startSession: (input: {
		surface: AISurface;
		target?: "auto" | "selection" | "block" | "document";
	}) => AISession | null;
	openContextualPrompt: (input?: {
		surface?: Extract<AISurface, "inline-edit">;
		target?: "auto" | "selection" | "block" | "document";
	}) => AISession | null;
	updateContextualPromptDraft: (sessionId: string, draftPrompt: string) => void;
	runSessionPrompt: (
		sessionId: string,
		prompt: string,
		options?: AICommandExecutionOptions,
	) => Promise<GenerationState | null>;
	resolveSessionTurn: (
		sessionId: string,
		turnId: string,
		resolution: AISessionResolution,
	) => boolean;
	acceptSessionTurn: (sessionId: string, turnId: string) => boolean;
	rejectSessionTurn: (sessionId: string, turnId: string) => boolean;
	resolveSession: (sessionId: string, resolution: AISessionResolution) => boolean;
	acceptSession: (sessionId: string) => boolean;
	rejectSession: (sessionId: string) => boolean;
	cancelSession: (sessionId: string) => void;
	suspendInlineSession: (sessionId: string) => void;
	resumeInlineSession: (sessionId: string) => void;
} {
	const controller = getAIController(editor);

	return {
		startSession(input) {
			return controller?.startSession(input) ?? null;
		},
		openContextualPrompt(input) {
			return controller?.openContextualPrompt(input) ?? null;
		},
		updateContextualPromptDraft(sessionId, draftPrompt) {
			controller?.updateContextualPromptDraft(sessionId, draftPrompt);
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
		acceptSessionTurn(sessionId, turnId) {
			return controller?.acceptSessionTurn(sessionId, turnId) ?? false;
		},
		rejectSessionTurn(sessionId, turnId) {
			return controller?.rejectSessionTurn(sessionId, turnId) ?? false;
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
		suspendInlineSession(sessionId) {
			controller?.suspendInlineSession(sessionId);
		},
		resumeInlineSession(sessionId) {
			controller?.resumeInlineSession(sessionId);
		},
	};
}
