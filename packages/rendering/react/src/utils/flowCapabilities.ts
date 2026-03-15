import type { DocumentProfile, Editor } from "@pen/types";
import {
	getFlowCapabilityFromSchema as getSharedFlowCapabilityFromSchema,
	getFlowCapabilityFromType as getSharedFlowCapabilityFromType,
	isContinuousTextFlowCapability as isSharedContinuousTextFlowCapability,
	shouldAllowDirectBlockPaste as shouldAllowSharedDirectBlockPaste,
	shouldAllowFlowInsertionInSlashMenu as shouldAllowSharedFlowInsertionInSlashMenu,
	shouldShowBlockInDefaultMenus as shouldShowSharedBlockInDefaultMenus,
	shouldFallbackMixedSelectionToBlock as shouldFallbackSharedMixedSelectionToBlock,
	shouldForceBlockScopedSelectAll as shouldForceSharedBlockScopedSelectAll,
	type FlowBlockCapability,
} from "@pen/types";
export type { FlowBlockCapability } from "@pen/types";

export function getFlowCapabilityFromSchema(
	schema: Parameters<typeof getSharedFlowCapabilityFromSchema>[0],
): FlowBlockCapability | null {
	return getSharedFlowCapabilityFromSchema(schema);
}

export function getFlowCapabilityFromType(
	blockType: string | null | undefined,
): FlowBlockCapability | null {
	return getSharedFlowCapabilityFromType(blockType);
}

export function getEditorFlowCapability(
	editor: Editor,
	blockId: string,
): FlowBlockCapability | null {
	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}

	return getFlowCapabilityFromSchema(editor.schema.resolve(block.type));
}

export function shouldFallbackMixedSelectionToBlock(
	documentProfile: DocumentProfile,
	capability: FlowBlockCapability | null,
): boolean {
	return shouldFallbackSharedMixedSelectionToBlock(documentProfile, capability);
}

export function shouldForceBlockScopedSelectAll(
	documentProfile: DocumentProfile,
	capability: FlowBlockCapability | null,
): boolean {
	return shouldForceSharedBlockScopedSelectAll(documentProfile, capability);
}

export function isContinuousTextFlowCapability(
	capability: FlowBlockCapability | null,
): boolean {
	return isSharedContinuousTextFlowCapability(capability);
}

export function shouldAllowFlowInsertionInSlashMenu(
	documentProfile: DocumentProfile,
	capability: FlowBlockCapability | null,
): boolean {
	return shouldAllowSharedFlowInsertionInSlashMenu(documentProfile, capability);
}

export function shouldShowBlockInDefaultMenus(
	documentProfile: DocumentProfile,
	schema: Parameters<typeof shouldShowSharedBlockInDefaultMenus>[1],
): boolean {
	return shouldShowSharedBlockInDefaultMenus(documentProfile, schema);
}

export function shouldAllowDirectBlockPaste(
	documentProfile: DocumentProfile,
	capability: FlowBlockCapability | null,
): boolean {
	return shouldAllowSharedDirectBlockPaste(documentProfile, capability);
}
