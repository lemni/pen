import React, { useRef, useLayoutEffect } from "react";
import type { Editor, InlineDecoration } from "@pen/types";
import { useEditorContentContext } from "../../context/editorContentContext";
import { useEditorContext } from "../../context/editorContext";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { fullReconcileDeltasToDOM } from "../../field-editor/reconciler";
import { useBlockEditingState } from "../../hooks/useBlockEditingState";
import { useBlockCommitState } from "../../hooks/useBlockCommitState";
import { useBlockDecorations } from "../../hooks/useBlockDecorations";
import { useSelection } from "../../hooks/useSelection";
import { useBlockTextSnapshot } from "../../hooks/useBlockTextSnapshot";
import { useFieldEditorState } from "../../hooks/useFieldEditorState";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { applyInlineDecorationsToDeltas } from "../../utils/inlineDecorations";

export interface InlineContentProps extends AsChildProps {
	blockId: string;
	placeholder?: string;
	ref?: React.Ref<HTMLElement>;
}

export function InlineContent(props: InlineContentProps) {
	const { blockId, placeholder: placeholderProp, ...rest } = props;
	const { editor } = useEditorContext();
	const { emptyPlaceholder, isEmpty: isDocumentEmpty } =
		useEditorContentContext();
	const fieldEditor = useFieldEditorContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const isActive = useBlockEditingState(fieldEditor, blockId);
	const selection = useSelection(editor);
	const blockCommit = useBlockCommitState(editor, blockId);
	const blockDecorations = useBlockDecorations(editor, blockId);
	const textSnapshot = useBlockTextSnapshot(editor, blockId);
	const elementRef = useRef<HTMLElement>(null);
	const previousCommitRevisionRef = useRef(blockCommit.revision);
	const isExpandedOwnedBlock =
		fieldEditorState.mode === "expanded" &&
		fieldEditorState.activeBlockIds.includes(blockId);

	const isFirstBlock = editor.documentState.blockOrder[0] === blockId;
	const schemaPlaceholder = resolveSchemaPlaceholder(editor, blockId);
	const isFocusedBlock =
		isActive ||
		(selection?.type === "text" &&
			selection.isCollapsed &&
			selection.focus.blockId === blockId);

	const blockTextEmpty = !textSnapshot.text || textSnapshot.text === "\u200B";
	const showDocumentPlaceholder =
		blockTextEmpty && isFirstBlock && isDocumentEmpty && !!emptyPlaceholder;
	const showExplicitPlaceholder =
		blockTextEmpty &&
		isFocusedBlock &&
		!!placeholderProp &&
		!showDocumentPlaceholder;
	const showBlockPlaceholder =
		blockTextEmpty &&
		isFocusedBlock &&
		!placeholderProp &&
		!!schemaPlaceholder &&
		!showDocumentPlaceholder;

	const placeholder =
		showDocumentPlaceholder
			? emptyPlaceholder
			: showExplicitPlaceholder
				? placeholderProp
				: showBlockPlaceholder
					? schemaPlaceholder
					: undefined;
	const inlineDecorations = blockDecorations.filter(
		(decoration): decoration is InlineDecoration => decoration.type === "inline",
	);
	const renderedDeltas =
		inlineDecorations.length > 0
			? applyInlineDecorationsToDeltas(
				textSnapshot.deltas,
				inlineDecorations,
			)
			: textSnapshot.deltas;

	useLayoutEffect(() => {
		if (fieldEditorState.mode === "expanded") {
			return;
		}
		if (isActive && elementRef.current && fieldEditor) {
			fieldEditor.attachElement(elementRef.current);
		}
	}, [isActive, fieldEditor, fieldEditorState.mode, blockId]);

	useLayoutEffect(() => {
		const didCommitAdvance =
			blockCommit.revision !== previousCommitRevisionRef.current;
		previousCommitRevisionRef.current = blockCommit.revision;

		const activeElement = elementRef.current?.ownerDocument?.activeElement;
		const isBackendOwned =
			!!elementRef.current &&
			isActive &&
			(activeElement instanceof Node
				? elementRef.current.contains(activeElement)
				: false);
		const shouldForceCommitReconcile =
			didCommitAdvance && blockCommit.origin === "history";

		if (isExpandedOwnedBlock || isActive) {
			return;
		}
		if (!elementRef.current) {
			return;
		}
		if (
			!shouldForceCommitReconcile &&
			(isBackendOwned || fieldEditorState.isComposing)
		) {
			return;
		}
		if (!textSnapshot.exists) {
			elementRef.current.replaceChildren();
			return;
		}
		fullReconcileDeltasToDOM(
			[...renderedDeltas],
			elementRef.current,
			editor.schema,
			{ preserveSelection: false },
		);
	}, [
		editor,
		isExpandedOwnedBlock,
		fieldEditorState.isComposing,
		fieldEditorState.activeBlockIds,
		fieldEditorState.mode,
		blockCommit,
		isActive,
		renderedDeltas,
		textSnapshot,
	]);

	const showPlaceholder =
		showDocumentPlaceholder || showExplicitPlaceholder || showBlockPlaceholder;
	const isActiveSurface = isActive && fieldEditorState.mode !== "expanded";

	const primitiveProps: Record<string, unknown> = {
		[DATA_ATTRS.inlineContent]: "",
		[DATA_ATTRS.fieldEditorSurface]: "",
		[DATA_ATTRS.fieldEditorActiveSurface]: isActiveSurface ? "" : undefined,
		[DATA_ATTRS.placeholderVisible]: showPlaceholder ? "" : undefined,
		"data-placeholder": showPlaceholder ? placeholder : undefined,
		style: showPlaceholder
			? {
				position: "relative" as const,
			}
			: undefined,
	};

	return renderAsChild({ ...rest, ref: elementRef }, "span", primitiveProps);
}

function resolveSchemaPlaceholder(
	editor: Pick<Editor, "getBlock" | "schema">,
	blockId: string,
): string | undefined {
	const block = editor.getBlock(blockId);
	if (!block) return undefined;
	return editor.schema.resolve(block.type)?.placeholder;
}
