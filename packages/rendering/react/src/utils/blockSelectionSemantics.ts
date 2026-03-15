import type { BlockSelectionRole, Editor } from "@pen/types";
import {
	getBlockSelectionRoleFromSchema as getSharedBlockSelectionRoleFromSchema,
	getBlockSelectionRoleFromType as getSharedBlockSelectionRoleFromType,
} from "@pen/types";
export type { BlockSelectionRole } from "@pen/types";

export function getBlockSelectionRoleFromSchema(
	schema: Parameters<typeof getSharedBlockSelectionRoleFromSchema>[0],
): BlockSelectionRole | null {
	return getSharedBlockSelectionRoleFromSchema(schema);
}

export function getBlockSelectionRoleFromType(
	blockType: string | null | undefined,
): BlockSelectionRole {
	return getSharedBlockSelectionRoleFromType(blockType);
}

export function getEditorBlockSelectionRole(
	editor: Editor,
	blockId: string,
): BlockSelectionRole | null {
	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}

	return getBlockSelectionRoleFromSchema(editor.schema.resolve(block.type));
}

export function getSelectionLengthForRole(
	role: BlockSelectionRole | null,
	textLength: number,
): number {
	if (role && role !== "editable-inline") {
		return 1;
	}

	return textLength;
}

export function getEditorBlockSelectionLength(
	editor: Editor,
	blockId: string,
): number {
	const block = editor.getBlock(blockId);
	if (!block) {
		return 0;
	}

	return getSelectionLengthForRole(
		getEditorBlockSelectionRole(editor, blockId),
		block.textContent().length,
	);
}

export function isInlineEditableBlock(
	editor: Editor,
	blockId: string,
): boolean {
	return getEditorBlockSelectionRole(editor, blockId) === "editable-inline";
}
