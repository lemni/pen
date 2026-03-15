import type { DocumentOp } from "@pen/types";
import type {
	AIMutationReceipt,
	AIMutationReceiptEvidence,
	AIMutationReceiptStatus,
} from "../types";
import type {
	AIBlockAdapterId,
	AIBlockClass,
	AITransportKind,
} from "./contracts";

export interface BuildMutationReceiptInput {
	status: AIMutationReceiptStatus;
	ops?: readonly DocumentOp[];
	adapterId: AIBlockAdapterId;
	blockClass: AIBlockClass;
	transportKind: AITransportKind;
	issues?: readonly string[];
}

export function buildMutationReceipt(
	input: BuildMutationReceiptInput,
): AIMutationReceipt {
	return {
		id: crypto.randomUUID(),
		status: input.status,
		evidence: buildMutationEvidence(
			input.ops ?? [],
			input.adapterId,
			input.blockClass,
			input.transportKind,
		),
		issues: [...(input.issues ?? [])],
	};
}

function buildMutationEvidence(
	ops: readonly DocumentOp[],
	adapterId: AIBlockAdapterId,
	blockClass: AIBlockClass,
	transportKind: AITransportKind,
): AIMutationReceiptEvidence {
	const affectedBlockIds = new Set<string>();
	const createdBlockIds = new Set<string>();

	for (const op of ops) {
		const blockId = readBlockId(op);
		if (blockId) {
			affectedBlockIds.add(blockId);
		}
		if (op.type === "insert-block") {
			createdBlockIds.add(op.blockId);
		}
	}

	return {
		commitId: crypto.randomUUID(),
		opsCount: ops.length,
		affectedBlockIds: [...affectedBlockIds],
		createdBlockIds: [...createdBlockIds],
		adapterId,
		blockClass,
		transportKind,
	};
}

function readBlockId(op: DocumentOp): string | null {
	return "blockId" in op && typeof op.blockId === "string" ? op.blockId : null;
}
