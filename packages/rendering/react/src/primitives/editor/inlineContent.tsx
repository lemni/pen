import React, { useRef, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
	getOpOriginType,
	type Editor,
	type InlineDecoration,
	type SelectionState,
} from "@pen/types";
import {
	domPointToLogicalOffset,
	getInlineAtomElementData,
	getLogicalTextContent,
	INLINE_ATOM_REPLACEMENT_TEXT,
} from "@pen/dom/field-editor/inlineAtomDom";
import { useEditorContentContext } from "../../context/editorContentContext";
import {
	useEditorContext,
	type InlineAtomRenderer,
	type InlineAtomRenderers,
} from "../../context/editorContext";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { fullReconcileDeltasToDOM } from "../../field-editor/reconciler";
import { useBlockEditingState } from "../../hooks/useBlockEditingState";
import { useBlockCommitState } from "../../hooks/useBlockCommitState";
import { useBlockDecorations } from "../../hooks/useBlockDecorations";
import { useSelection } from "../../hooks/useSelection";
import { useBlockTextSnapshot } from "../../hooks/useBlockTextSnapshot";
import { useFieldEditorState } from "../../hooks/useFieldEditorState";
import { useInlineCompletionState } from "../../hooks/useInlineCompletionState";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { fieldEditorTextEntryAttrs } from "../../utils/fieldEditorTextEntryAttrs";
import { applyInlineDecorationsToDeltas } from "../../utils/inlineDecorations";
import { resolveInlinePlaceholderVisibility } from "../../utils/placeholderVisibility";

export interface InlineContentProps extends AsChildProps {
	blockId: string;
	className?: string;
	placeholder?: string;
	ref?: React.Ref<HTMLElement>;
}

interface InlineAtomRenderTarget {
	key: string;
	element: HTMLElement;
	renderer: InlineAtomRenderer;
	type: string;
	props: Record<string, unknown>;
	text: string;
	offset: number;
}

export function InlineContent(props: InlineContentProps) {
	const { blockId, className, placeholder: placeholderProp, ...rest } = props;
	const { editor, inlineAtomRenderers } = useEditorContext();
	const { emptyPlaceholder, isEmpty: isDocumentEmpty } =
		useEditorContentContext();
	const fieldEditor = useFieldEditorContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const isActive = useBlockEditingState(fieldEditor, blockId);
	const selection = useSelection(editor);
	const blockCommit = useBlockCommitState(editor, blockId);
	const blockDecorations = useBlockDecorations(editor, blockId);
	const textSnapshot = useBlockTextSnapshot(editor, blockId);
	const visibleInlineCompletion = useInlineCompletionState(editor);
	const elementRef = useRef<HTMLElement>(null);
	const previousCommitRevisionRef = useRef(blockCommit.revision);
	const previousRenderedDeltasSignatureRef = useRef<string | null>(null);
	const inlineAtomTargetsRef = useRef<InlineAtomRenderTarget[]>([]);
	const [inlineAtomTargets, setInlineAtomTargets] = useState<
		InlineAtomRenderTarget[]
	>([]);
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
	const emptyInlineCompletionText =
		visibleInlineCompletion?.type === "inline" &&
		visibleInlineCompletion.blockId === blockId &&
		blockTextEmpty &&
		visibleInlineCompletion.text.length > 0
			? visibleInlineCompletion.text
			: null;
	const {
		showDocumentPlaceholder,
		showExplicitPlaceholder,
		showBlockPlaceholder,
	} = resolveInlinePlaceholderVisibility({
		blockTextEmpty,
		isDocumentEmpty,
		isFirstBlock,
		isFocusedBlock,
		hasEmptyPlaceholder: !!emptyPlaceholder,
		hasExplicitPlaceholder: !!placeholderProp,
		hasSchemaPlaceholder: !!schemaPlaceholder,
		suppressPlaceholders: visibleInlineCompletion !== null,
	});

	const placeholder = showDocumentPlaceholder
		? emptyPlaceholder
		: showExplicitPlaceholder
			? placeholderProp
			: showBlockPlaceholder
				? schemaPlaceholder
				: undefined;
	const inlineDecorations = blockDecorations.filter(
		(decoration): decoration is InlineDecoration =>
			decoration.type === "inline",
	);
	const renderedDeltas =
		inlineDecorations.length > 0
			? applyInlineDecorationsToDeltas(
					textSnapshot.deltas,
					inlineDecorations,
				)
			: textSnapshot.deltas;
	const renderedDeltasText = getDeltaText(renderedDeltas);
	const renderedDeltasSignature = getDeltaSignature(renderedDeltas);

	useLayoutEffect(() => {
		if (fieldEditorState.mode === "expanded") {
			return;
		}
		if (isActive && elementRef.current && fieldEditor) {
			fieldEditor.attachElement(elementRef.current);
		}
	}, [isActive, fieldEditor, fieldEditorState.mode, blockId]);

	useLayoutEffect(() => {
		const syncInlineAtomTargets = () => {
			const nextTargets = resolveNextInlineAtomTargets(
				elementRef.current,
				inlineAtomRenderers,
				inlineAtomTargetsRef.current,
			);
			if (nextTargets !== inlineAtomTargetsRef.current) {
				inlineAtomTargetsRef.current = nextTargets;
				setInlineAtomTargets(nextTargets);
			}
		};

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
			didCommitAdvance &&
			blockCommit.origin !== null &&
			getOpOriginType(blockCommit.origin) === "history";

		if (isExpandedOwnedBlock || isActive) {
			if (!elementRef.current || fieldEditorState.isComposing) {
				syncInlineAtomTargets();
				return;
			}
			if (!textSnapshot.exists) {
				elementRef.current.replaceChildren();
				previousRenderedDeltasSignatureRef.current = null;
				syncInlineAtomTargets();
				return;
			}
			if (
				!shouldForceCommitReconcile &&
				getLogicalTextContent(elementRef.current) ===
					renderedDeltasText &&
				previousRenderedDeltasSignatureRef.current ===
					renderedDeltasSignature
			) {
				syncInlineAtomTargets();
				return;
			}
			fullReconcileDeltasToDOM(
				[...renderedDeltas],
				elementRef.current,
				editor.schema,
				{ preserveSelection: true },
			);
			previousRenderedDeltasSignatureRef.current =
				renderedDeltasSignature;
			syncInlineAtomTargets();
			return;
		}
		if (!elementRef.current) {
			syncInlineAtomTargets();
			return;
		}
		if (
			!shouldForceCommitReconcile &&
			(isBackendOwned || fieldEditorState.isComposing)
		) {
			syncInlineAtomTargets();
			return;
		}
		if (!textSnapshot.exists) {
			elementRef.current.replaceChildren();
			previousRenderedDeltasSignatureRef.current = null;
			syncInlineAtomTargets();
			return;
		}
		fullReconcileDeltasToDOM(
			[...renderedDeltas],
			elementRef.current,
			editor.schema,
			{ preserveSelection: false },
		);
		previousRenderedDeltasSignatureRef.current = renderedDeltasSignature;
		syncInlineAtomTargets();
	}, [
		editor,
		isExpandedOwnedBlock,
		fieldEditorState.isComposing,
		fieldEditorState.domSyncVersion,
		fieldEditorState.activeBlockIds,
		fieldEditorState.mode,
		blockCommit,
		isActive,
		renderedDeltas,
		renderedDeltasSignature,
		renderedDeltasText,
		textSnapshot,
		inlineAtomRenderers,
	]);

	useLayoutEffect(() => {
		inlineAtomTargetsRef.current = inlineAtomTargets;
	}, [inlineAtomTargets]);

	const showPlaceholder =
		showDocumentPlaceholder ||
		showExplicitPlaceholder ||
		showBlockPlaceholder;
	const isActiveSurface = isActive && fieldEditorState.mode !== "expanded";

	const primitiveProps: Record<string, unknown> = {
		[DATA_ATTRS.inlineContent]: "",
		[DATA_ATTRS.fieldEditorSurface]: "",
		...fieldEditorTextEntryAttrs(isActiveSurface),
		className: getInlineContentClassName(
			className,
			emptyInlineCompletionText,
		),
		"data-suggestion-id": emptyInlineCompletionText
			? visibleInlineCompletion?.id
			: undefined,
		"data-suggestion-text": emptyInlineCompletionText ?? undefined,
		"data-suggestion-type": emptyInlineCompletionText
			? "inline"
			: undefined,
		"data-suggestion-placement": emptyInlineCompletionText
			? "after"
			: undefined,
		[DATA_ATTRS.placeholderVisible]: showPlaceholder ? "" : undefined,
		"data-placeholder": showPlaceholder ? placeholder : undefined,
		style: showPlaceholder
			? {
					position: "relative" as const,
				}
			: undefined,
	};
	const inlineAtomPortals = inlineAtomTargets.map((target) =>
		createPortal(
			target.renderer({
				type: target.type,
				props: target.props,
				text: target.text,
				selected: isInlineAtomSelected(
					selection,
					blockId,
					target.offset,
				),
			}),
			target.element,
			target.key,
		),
	);

	useLayoutEffect(() => {
		inlineAtomTargets.forEach((target) => {
			target.element.toggleAttribute(
				DATA_ATTRS.selected,
				isInlineAtomSelected(selection, blockId, target.offset),
			);
		});
	}, [blockId, inlineAtomTargets, selection]);

	return (
		<>
			{renderAsChild(
				{ ...rest, ref: elementRef },
				"span",
				primitiveProps,
			)}
			{inlineAtomPortals}
		</>
	);
}

function resolveNextInlineAtomTargets(
	root: HTMLElement | null,
	renderers: InlineAtomRenderers | undefined,
	currentTargets: InlineAtomRenderTarget[],
): InlineAtomRenderTarget[] {
	if (!root || !renderers) {
		return currentTargets.length === 0 ? currentTargets : [];
	}

	const nextTargets = Array.from(
		root.querySelectorAll<HTMLElement>(`[${DATA_ATTRS.inlineAtom}]`),
	).flatMap((element, index): InlineAtomRenderTarget[] => {
		const data = getInlineAtomElementData(element);
		if (!data) {
			return [];
		}

		const renderer = renderers[data.type];
		if (!renderer) {
			return [];
		}
		clearInlineAtomFallbackText(element, data.text);
		const offset = domPointToLogicalOffset(root, element, 0);

		return [
			{
				key: getInlineAtomTargetKey(data, index),
				element,
				renderer,
				type: data.type,
				props: data.props,
				text: data.text,
				offset,
			},
		];
	});

	return areInlineAtomTargetsEqual(currentTargets, nextTargets)
		? currentTargets
		: nextTargets;
}

function areInlineAtomTargetsEqual(
	currentTargets: InlineAtomRenderTarget[],
	nextTargets: InlineAtomRenderTarget[],
): boolean {
	if (currentTargets.length !== nextTargets.length) {
		return false;
	}

	return currentTargets.every((target, index) => {
		const nextTarget = nextTargets[index];
		return (
			target.key === nextTarget.key &&
			target.element === nextTarget.element &&
			target.renderer === nextTarget.renderer &&
			target.offset === nextTarget.offset &&
			target.text === nextTarget.text &&
			shallowEqualRecords(target.props, nextTarget.props)
		);
	});
}

function getInlineAtomTargetKey(
	data: { type: string; props: Record<string, unknown>; text: string },
	index: number,
): string {
	return `${index}:${data.type}:${data.text}:${JSON.stringify(data.props)}`;
}

function isInlineAtomSelected(
	selection: SelectionState,
	blockId: string,
	offset: number,
): boolean {
	if (
		selection?.type !== "text" ||
		selection.isCollapsed ||
		selection.anchor.blockId !== blockId ||
		selection.focus.blockId !== blockId
	) {
		return false;
	}

	const selectionStart = Math.min(
		selection.anchor.offset,
		selection.focus.offset,
	);
	const selectionEnd = Math.max(
		selection.anchor.offset,
		selection.focus.offset,
	);
	return selectionStart <= offset && selectionEnd >= offset + 1;
}

function clearInlineAtomFallbackText(element: HTMLElement, text: string): void {
	if (
		element.childNodes.length === 1 &&
		element.firstChild?.nodeType === Node.TEXT_NODE &&
		element.textContent === text
	) {
		element.replaceChildren();
		return;
	}

	for (const child of Array.from(element.childNodes)) {
		if (
			child.nodeType === Node.TEXT_NODE &&
			(child.textContent === text ||
				child.textContent === INLINE_ATOM_REPLACEMENT_TEXT)
		) {
			child.remove();
		}
	}
}

function shallowEqualRecords(
	left: Record<string, unknown>,
	right: Record<string, unknown>,
): boolean {
	if (left === right) {
		return true;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	return leftKeys.every((key) => Object.is(left[key], right[key]));
}

function getInlineContentClassName(
	className: string | undefined,
	emptyInlineCompletionText: string | null,
): string | undefined {
	if (!emptyInlineCompletionText) {
		return className;
	}
	return [className, "pen-ephemeral-suggestion"].filter(Boolean).join(" ");
}

function resolveSchemaPlaceholder(
	editor: Pick<Editor, "getBlock" | "schema">,
	blockId: string,
): string | undefined {
	const block = editor.getBlock(blockId);
	if (!block) return undefined;
	return editor.schema.resolve(block.type)?.placeholder;
}

function getDeltaText(
	deltas: readonly { insert: string | Record<string, unknown> }[],
): string {
	return deltas
		.map((delta) =>
			typeof delta.insert === "string"
				? delta.insert
				: getInlineNodeText(delta.insert),
		)
		.join("");
}

function getDeltaSignature(
	deltas: readonly {
		attributes?: Record<string, unknown>;
		insert: string | Record<string, unknown>;
	}[],
): string {
	return JSON.stringify(
		deltas.map((delta) => [delta.insert, delta.attributes ?? null]),
	);
}

function getInlineNodeText(insert: Record<string, unknown>): string {
	return INLINE_ATOM_REPLACEMENT_TEXT;
}
