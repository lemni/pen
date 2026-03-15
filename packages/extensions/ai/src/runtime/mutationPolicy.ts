import type { SelectionState } from "@pen/types";
import type {
	AIContentFormat,
	AIMutationMode,
	AIRouteLane,
} from "./contracts";

interface MutationPolicyInput {
	lane: AIRouteLane;
	suggestMode: boolean;
	selection: SelectionState;
	surface?: "inline-edit" | "bottom-chat";
}

export function resolveMutationMode(
	input: MutationPolicyInput,
): AIMutationMode {
	if (input.lane === "selection-rewrite") {
		return "streaming-suggestions";
	}
	if (
		(input.surface === "bottom-chat" ||
			input.surface === "inline-edit") &&
		(input.lane === "cursor-context" || input.lane === "context-first")
	) {
		return "streaming-suggestions";
	}
	if (input.lane === "cursor-context") {
		return "direct-stream";
	}
	if (input.lane === "context-first") {
		return "persistent-suggestions";
	}
	if (input.lane === "review") {
		return "staged-review";
	}
	if (input.suggestMode || isStructuralSelection(input.selection)) {
		return "persistent-suggestions";
	}
	return input.lane === "tool-loop"
		? "persistent-suggestions"
		: "direct-stream";
}

function isStructuralSelection(selection: SelectionState): boolean {
	return selection?.type === "block" || selection?.type === "cell";
}

export function shouldStreamDirectAIOutput(options: {
	mutationMode: AIMutationMode;
	contentFormat: AIContentFormat;
	target: "selection" | "block";
}): boolean {
	if (
		options.target === "block" &&
		options.contentFormat === "markdown"
	) {
		return false;
	}

	return (
		options.mutationMode === "direct-stream" ||
		options.mutationMode === "ephemeral-preview"
	);
}
