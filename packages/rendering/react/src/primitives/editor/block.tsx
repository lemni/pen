import React, { useRef } from "react";
import { useEditorContext } from "../../context/editorContext";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { useBlockDecorations } from "../../hooks/useBlockDecorations";
import { useBlockEditingState } from "../../hooks/useBlockEditingState";
import { useBlockModel } from "../../hooks/useBlockModel";
import { useBlockSelectionState } from "../../hooks/useBlockSelectionState";
import { useBlockSurfaceRole } from "../../hooks/useBlockSurfaceRole";
import { resolveRenderer } from "../../renderers/index";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import type { BlockRenderContext } from "@pen/core";
import { useBlockDropPreview } from "./dropPreviewContext";

export interface EditorBlockProps extends AsChildProps {
	blockId: string;
	ref?: React.Ref<HTMLElement>;
}

export function EditorBlock(props: EditorBlockProps) {
	const { blockId, ...rest } = props;
	const {
		editor,
		readonly,
		renderers,
		blockControls,
	} = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const isEditable = useBlockEditingState(fieldEditor, blockId);
	const blockModel = useBlockModel(editor, blockId);
	const isSelected = useBlockSelectionState(editor, blockId);
	const surfaceRole = useBlockSurfaceRole(editor, fieldEditor, blockId);
	const blockDecorations = useBlockDecorations(editor, blockId);
	const externalDropPosition = useBlockDropPreview(blockId);
	const blockRef = useRef<HTMLElement>(null);

	if (!blockModel.exists) return null;

	const block = editor.getBlock(blockId);
	if (!block) return null;

	const blockType = blockModel.type ?? block.type;

	const isBlockEditable = !readonly && !!fieldEditor && isEditable;

	const renderCtx: BlockRenderContext = {
		editable: isBlockEditable,
		selected: isSelected,
		decorations: blockDecorations,
		ref: blockRef,
	};

	const Renderer = renderers?.[blockType] ?? resolveRenderer(blockType);
	const headingLevel =
		blockType === "heading" && typeof block.props?.level === "number"
			? block.props.level
			: undefined;
	const blockControl = blockControls?.({
		blockId,
		blockType,
		selected: isSelected,
	});

	const isAiGenerating = blockDecorations.some(
		(d: any) => d.type === "ai-generating" || d.attrs?.["ai-generating"],
	);

	const primitiveProps: Record<string, unknown> = {
		[DATA_ATTRS.editorBlock]: "",
		[DATA_ATTRS.blockId]: blockId,
		[DATA_ATTRS.blockType]: blockType,
		"data-level": headingLevel,
		[DATA_ATTRS.selected]: isSelected || undefined,
		[DATA_ATTRS.focused]: fieldEditor?.focusBlockId === blockId || undefined,
		[DATA_ATTRS.surfaceRole]: surfaceRole ?? undefined,
		[DATA_ATTRS.dropTarget]: externalDropPosition ? true : undefined,
		[DATA_ATTRS.dropPosition]: externalDropPosition,
		[DATA_ATTRS.aiGenerating]: isAiGenerating || undefined,
		tabIndex: -1,
		contentEditable:
			surfaceRole != null && surfaceRole !== "editable-inline"
				? false
				: undefined,
	};

	return renderAsChild(
		{
			...rest,
			children: (
				<>
					{blockControl}
					{Renderer(block, renderCtx) as React.ReactNode}
				</>
			),
			ref: blockRef,
		},
		"div",
		primitiveProps,
	);
}
