import React, { useRef, useEffect, useLayoutEffect } from "react";
import type { Editor, MoveBlockOp } from "@pen/types";
import {
	generateId,
	usesInlineTextSelection,
} from "@pen/types";
import { flushSync } from "react-dom";
import { EditorContentContext } from "../../context/editorContentContext";
import { useEditorContext } from "../../context/editorContext";
import { useFieldEditorContext } from "../../context/fieldEditorContext";
import { shouldUseBlockSelection } from "../../field-editor/crossBlock";
import {
	domSelectionToEditor,
	getBlockBoundaryPoint,
	pointToEditorSelectionPoint,
} from "../../field-editor/selectionBridge";
import { useFieldEditorState } from "../../hooks/useFieldEditorState";
import { useAIStructuredPreviewContent } from "../../hooks/useAIStructuredPreview";
import { useBlockList } from "../../hooks/useBlockList";
import {
	getEditorBlockSelectionLength,
	getEditorBlockSelectionRole,
} from "../../utils/blockSelectionSemantics";
import {
	isRepeatedCellSelection,
	resolveBlockPointerIntent,
} from "../../utils/editorInteractionModel";
import { normalizeSelectionFormation } from "../../utils/selectionFormation";
import {
	useDocumentEmptyState,
	useDocumentPlaceholderState,
} from "../../hooks/useDocumentEmptyState";
import { useInlineCompletionState } from "../../hooks/useInlineCompletionState";
import {
	getEditorFlowCapability,
	shouldFallbackMixedSelectionToBlock,
} from "../../utils/flowCapabilities";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { DATA_ATTRS } from "../../utils/dataAttributes";
import { fieldEditorTextEntryAttrs } from "../../utils/fieldEditorTextEntryAttrs";
import { AIStructuredTargetPreviewItem } from "../ai/structuredTargetPreview";
import { AutocompletePreviewBlock } from "./autocompletePreviewBlock";
import { EditorBlock } from "./block";
import {
	DropPreviewProvider,
} from "./dropPreviewContext";
import {
	BLOCK_DRAG_MIME,
	buildMoveBlockOps,
	parseBlockDragPayload,
	type BlockDropPosition,
	useBlockDragSession,
} from "./blockDragSession";
import {
	intersectRegionSelectionRect,
	resolveRegionRect,
	useEditorRegionSelectionContext,
	type RegionSelectionRect,
	type RegionSelectorConfig,
} from "./regionSelectionState";
import { useTransferSession } from "./useTransferSession";
import {
	createPointerSelectionGesture,
	resolvePointerDragSelection,
	type PointerSelectionGesture,
} from "../../selection/interactionController";

export interface EditorContentProps extends AsChildProps {
	virtualize?:
	| boolean
	| {
		overscan?: number;
		estimatedHeight?: number;
		mobileOverscan?: number;
	};
	emptyPlaceholder?: string;
	ref?: React.Ref<HTMLElement>;
}

export function EditorContent(props: EditorContentProps) {
	const { virtualize: _virtualize, emptyPlaceholder, ...rest } = props;
	const { editor, readonly, blockDragAndDrop, blockSelection, interactionModel } = useEditorContext();
	const fieldEditor = useFieldEditorContext();
	const { store: regionSelectionStore } = useEditorRegionSelectionContext();
	const fieldEditorState = useFieldEditorState(fieldEditor);
	const blockIds = useBlockList(editor);
	const contentItems = useAIStructuredPreviewContent(editor, blockIds);
	const visibleSuggestion = useInlineCompletionState(editor);
	const blockDragSession = useBlockDragSession();
	const contentRef = useRef<HTMLElement>(null);
	const blocksHostRef = blockDragSession.blocksHostRef as React.RefObject<HTMLDivElement | null>;
	const regionGestureRef = useRef<{
		clientX: number;
		clientY: number;
		isSelecting: boolean;
	} | null>(null);
	const pointerGestureRef = useRef<PointerSelectionGesture | null>(null);
	const pointerGestureVersionRef = useRef(0);
	const skipNextClickRef = useRef(false);
	const interactionModelRef = useRef(interactionModel);
	interactionModelRef.current = interactionModel;

	const isEmpty = useDocumentEmptyState(editor);
	const isDocumentPlaceholderVisible = useDocumentPlaceholderState(editor);
	const { isDropActive, dropPreview, inlineDropCaretStyle } =
		useTransferSession({
			editor,
			readonly,
			contentRef,
		});

	useLayoutEffect(() => {
		if (!fieldEditor || fieldEditorState.mode !== "expanded") return;
		if (!blocksHostRef.current) return;
		fieldEditor.attachElement(blocksHostRef.current);
	}, [fieldEditor, fieldEditorState.mode, fieldEditorState.activeBlockIds]);

	// Click-to-activate: when user clicks on a block, activate the field editor.
	// Shift-click: select a range of blocks (AC #22).
	useEffect(() => {
		const gestureEl = contentRef.current;
		if (!gestureEl || readonly || !fieldEditor) return;
		const currentEditorRoot = gestureEl.closest(
			"[data-pen-editor-root]",
		) as HTMLElement | null;

		const isWithinNestedEditorRoot = (target: EventTarget | null): boolean => {
			if (!(target instanceof Node)) {
				return false;
			}
			const element =
				target instanceof HTMLElement ? target : target.parentElement;
			const targetRoot = element?.closest(
				"[data-pen-editor-root]",
			) as HTMLElement | null;
			return targetRoot != null && targetRoot !== currentEditorRoot;
		};

		const resolveEventTargetElement = (
			target: EventTarget | null,
		): HTMLElement | null => {
			if (target instanceof HTMLElement) {
				return target;
			}

			if (target instanceof Node) {
				return target.parentElement;
			}

			return null;
		};

		const resolveClickedBlockId = (event: MouseEvent): string | null => {
			const target = resolveEventTargetElement(event.target);
			if (!target) return null;
			if (isWithinNestedEditorRoot(target)) return null;

			let blockEl: HTMLElement | null = target;
			while (blockEl && blockEl !== gestureEl) {
				if (blockEl.hasAttribute(DATA_ATTRS.editorBlock)) {
					break;
				}
				blockEl = blockEl.parentElement;
			}

			const blockId = blockEl?.getAttribute("data-block-id") ?? null;
			return blockId;
		};

		const handleClickOutsideBlocks = (event: MouseEvent): boolean => {
			const fe = fieldEditor;
			if (readonly || !fe) return false;
			const blocksHost = blocksHostRef.current;
			if (!blocksHost) return false;

			const firstBlockEl = blocksHost.querySelector(
				`[${DATA_ATTRS.editorBlock}]`,
			) as HTMLElement | null;
			const lastBlockEl = blocksHost.querySelector(
				`[${DATA_ATTRS.editorBlock}]:last-child`,
			) as HTMLElement | null;
			if (!firstBlockEl || !lastBlockEl) {
				const newBlockId = generateId();
				editor.apply([{
					type: "insert-block",
					blockId: newBlockId,
					blockType: "paragraph",
					props: {},
					position: "first",
				}], { origin: "user" });
				requestAnimationFrame(() => {
					fe.activateTextSelection?.(newBlockId, 0, 0);
				});
				return true;
			}

			if (isDocumentPlaceholderVisible) {
				const firstBlock = editor.firstBlock();
				if (firstBlock) {
					const schema = editor.schema.resolve(firstBlock.type);
					if (usesInlineTextSelection(schema)) {
						fe.activateTextSelection?.(firstBlock.id, 0, 0);
						return true;
					}
				}
			}

			const firstRect = firstBlockEl.getBoundingClientRect();
			const lastRect = lastBlockEl.getBoundingClientRect();
			const clickedAbove = event.clientY < firstRect.top;
			const clickedBelow = event.clientY > lastRect.bottom;

			if (!clickedAbove && !clickedBelow) return false;

			const adjacentBlock = clickedAbove ? editor.firstBlock() : editor.lastBlock();
			if (!adjacentBlock) return false;

			const schema = editor.schema.resolve(adjacentBlock.type);
			if (
				usesInlineTextSelection(schema) &&
				adjacentBlock.textContent().length === 0
			) {
				fe.activateTextSelection?.(adjacentBlock.id, 0, 0);
				return true;
			}

			const newBlockId = generateId();
			const position = clickedAbove
				? { before: adjacentBlock.id }
				: { after: adjacentBlock.id };
			editor.apply([{
				type: "insert-block",
				blockId: newBlockId,
				blockType: "paragraph",
				props: {},
				position,
			}], { origin: "user" });
			requestAnimationFrame(() => {
				fe.activateTextSelection?.(newBlockId, 0, 0);
			});
			return true;
		};

		const resolveClickedCellCoord = (
			event: MouseEvent,
			blockId: string,
		): { row: number; col: number } | null => {
			const target = resolveEventTargetElement(event.target);
			if (!target) return null;
			if (isWithinNestedEditorRoot(target)) return null;

			const cellEl = target.closest(
				`[${DATA_ATTRS.tableCell}]`,
			) as HTMLElement | null;
			if (!cellEl) return null;

			const rowAttr = cellEl.getAttribute(DATA_ATTRS.tableCellRow);
			const colAttr = cellEl.getAttribute(DATA_ATTRS.tableCellCol);
			if (rowAttr == null || colAttr == null) return null;

			const row = parseInt(rowAttr, 10);
			const col = parseInt(colAttr, 10);
			if (isNaN(row) || isNaN(col)) return null;

			return { row, col };
		};

		const shouldIgnorePointerGesture = (event: MouseEvent): boolean => {
			const target = resolveEventTargetElement(event.target);
			if (!target) return false;
			if (isWithinNestedEditorRoot(target)) return true;

			return !!target.closest("[data-pen-ignore-pointer-gesture]");
		};

		const getBoundaryPoint = (
			blockId: string,
			side: "start" | "end",
		): { blockId: string; offset: number } => {
			const root = gestureEl.closest(
				"[data-pen-editor-root]",
			) as HTMLElement | null;
			return (
				(root ? getBlockBoundaryPoint(root, blockId, side) : null) ?? {
					blockId,
					offset:
						side === "start"
							? 0
							: getEditorBlockSelectionLength(editor, blockId),
				}
			);
		};

		const getBlockIdRange = (
			anchorBlockId: string,
			targetBlockId: string,
		): string[] | null => {
			const blockOrder = editor.documentState.blockOrder;
			const anchorIdx = blockOrder.indexOf(anchorBlockId);
			const targetIdx = blockOrder.indexOf(targetBlockId);
			if (anchorIdx < 0 || targetIdx < 0) return null;

			const from = Math.min(anchorIdx, targetIdx);
			const to = Math.max(anchorIdx, targetIdx);
			return blockOrder.slice(from, to + 1);
		};

		const getRegionSelectorConfig = (
			event: MouseEvent,
		): RegionSelectorConfig | null => {
			if (!blockSelection.enabled) return null;
			const config = regionSelectionStore.getSnapshot().config;
			if (!config?.enabled) return null;
			if (config.selectionMode !== "block") return null;
			if (config.activation !== "whenInactive") return null;
			if (event.shiftKey || event.button !== 0) return null;
			if (fieldEditor.isComposing) return null;
			if (fieldEditor.focusBlockId) return null;
			if (fieldEditor.isEditing) return null;
			const regionRect = resolveRegionRect(config);
			if (
				regionRect &&
				!pointWithinRect(event.clientX, event.clientY, regionRect)
			) {
				return null;
			}
			if (shouldIgnorePointerGesture(event)) return null;
			if (resolveClickedBlockId(event)) return null;
			return config;
		};

		const getIntersectedBlockIds = (
			rect: RegionSelectionRect,
		): string[] => {
			const blocksHost = blocksHostRef.current;
			if (!blocksHost) return [];

			const selectedIds: string[] = [];
			const blockElements = Array.from(blocksHost.children);
			for (const child of blockElements) {
				if (
					!(child instanceof HTMLElement) ||
					!child.hasAttribute(DATA_ATTRS.editorBlock)
				) {
					continue;
				}

				const blockId = child.getAttribute(DATA_ATTRS.blockId);
				if (!blockId) continue;

				if (rectsIntersect(rect, child.getBoundingClientRect())) {
					selectedIds.push(blockId);
				}
			}

			return selectedIds;
		};

		const clearPointerSelectionState = () => {
			pointerGestureRef.current = null;
		};

		const clearRegionSelectionState = () => {
			regionGestureRef.current = null;
			regionSelectionStore.clearLiveRect();
		};

		const ensureEditorFocus = (root: HTMLElement) => {
			const doc = root.ownerDocument;
			const activeEl = doc?.activeElement;
			if (activeEl instanceof Node && root.contains(activeEl)) return;
			root.focus({ preventScroll: true });
		};

		const activateCanonicalSelection = (
			anchorPoint: { blockId: string; offset: number },
			focusPoint: { blockId: string; offset: number },
		) => {
			if (anchorPoint.blockId === focusPoint.blockId) {
				if (typeof fieldEditor.activateTextSelection === "function") {
					fieldEditor.activateTextSelection(
						anchorPoint.blockId,
						anchorPoint.offset,
						focusPoint.offset,
					);
				} else {
					editor.selectTextRange(anchorPoint, focusPoint);
					fieldEditor.activate(anchorPoint.blockId);
				}
				return;
			}

			const normalizedSelection = normalizeSelectionFormation(editor, {
				anchor: anchorPoint,
				focus: focusPoint,
			});
			if (normalizedSelection.type === "block") {
				if (!blockSelection.enabled) return;
				gestureEl.ownerDocument?.getSelection()?.removeAllRanges();
				editor.selectBlocks(normalizedSelection.blockIds);
				fieldEditor.deactivate();
				return;
			}

			const selectedIds = getBlockIdRange(
				normalizedSelection.anchor.blockId,
				normalizedSelection.focus.blockId,
			);
			if (!selectedIds) return;

			if (shouldUseBlockSelection(editor, selectedIds.length)) {
				if (blockSelection.enabled) {
					editor.selectBlocks(selectedIds);
					fieldEditor.deactivate();
					return;
				}
			}

			fieldEditor.applyDocumentTextSelection(
				normalizedSelection.anchor,
				normalizedSelection.focus,
			);
		};

		const handleClick = (event: MouseEvent) => {
			if (shouldIgnorePointerGesture(event)) {
				return;
			}

			if (skipNextClickRef.current) {
				skipNextClickRef.current = false;
				return;
			}

			const blockId = resolveClickedBlockId(event);
			if (!blockId) {
				if (handleClickOutsideBlocks(event)) {
					event.preventDefault();
				}
				return;
			}

			// Shift-click: select a range of blocks
			if (event.shiftKey) {
				const currentSelection = editor.selection;
				const anchorPoint =
					currentSelection?.type === "text"
						? currentSelection.anchor
						: currentSelection?.type === "block" &&
							currentSelection.blockIds.length > 0
							? getBoundaryPoint(
								currentSelection.blockIds[0],
								"start",
							)
							: fieldEditor.focusBlockId
								? getBoundaryPoint(
									fieldEditor.focusBlockId,
									"start",
								)
								: null;

				if (anchorPoint && anchorPoint.blockId !== blockId) {
					const selectedIds = getBlockIdRange(
						anchorPoint.blockId,
						blockId,
					);
					if (!selectedIds) return;

					const blockOrder = editor.documentState.blockOrder;
					const anchorIdx = blockOrder.indexOf(anchorPoint.blockId);
					const targetIdx = blockOrder.indexOf(blockId);
					const selectingForward = anchorIdx <= targetIdx;
					const targetPoint = getBoundaryPoint(
						blockId,
						selectingForward ? "end" : "start",
					);

					if (
						blockSelection.enabled &&
						shouldUseBlockSelection(editor, selectedIds.length)
					) {
						editor.selectBlocks(selectedIds);
						fieldEditor.deactivate();
						event.preventDefault();
						return;
					}

					activateCanonicalSelection(anchorPoint, targetPoint);
					event.preventDefault();
					return;
				}
			}
		};

		const handleMouseDown = (event: MouseEvent) => {
			if (event.shiftKey || event.button !== 0) return;
			if (fieldEditor.isComposing) return;
			if (shouldIgnorePointerGesture(event)) return;

			const regionSelectorConfig = getRegionSelectorConfig(event);
			if (regionSelectorConfig) {
				regionGestureRef.current = {
					clientX: event.clientX,
					clientY: event.clientY,
					isSelecting: false,
				};
				skipNextClickRef.current = false;
				fieldEditor.resetSelectAllCycle?.();
				return;
			}

			const blockId = resolveClickedBlockId(event);
			if (!blockId) return;
			pointerGestureVersionRef.current += 1;

			pointerGestureRef.current = createPointerSelectionGesture(editor, {
				blockId,
				clientX: event.clientX,
				clientY: event.clientY,
			});
			fieldEditor.beginPointerSelection();
			skipNextClickRef.current = false;
			fieldEditor.resetSelectAllCycle?.();
			const clickedBlock = editor.getBlock(blockId);
			const clickedSchema = clickedBlock
				? editor.schema.resolve(clickedBlock.type)
				: null;
			const root = gestureEl.closest(
				"[data-pen-editor-root]",
			) as HTMLElement | null;
			if (
				pointerGestureRef.current &&
				root &&
				clickedSchema &&
				usesInlineTextSelection(clickedSchema) &&
				pointerGestureRef.current.anchorPoint == null
			) {
				const initialPointerPoint = pointToEditorSelectionPoint(
					root,
					event.clientX,
					event.clientY,
				);
				if (initialPointerPoint?.blockId === blockId) {
					pointerGestureRef.current.anchorPoint = initialPointerPoint;
				}
			}
			const shouldSeedBlockSelection =
				shouldFallbackMixedSelectionToBlock(
					editor.documentProfile,
					getEditorFlowCapability(editor, blockId),
				);
			if (
				pointerGestureRef.current &&
				clickedSchema &&
				!usesInlineTextSelection(clickedSchema) &&
				pointerGestureRef.current.anchorPoint == null
			) {
				pointerGestureRef.current.anchorPoint = getBoundaryPoint(blockId, "start");
			}
			if (
				pointerGestureRef.current &&
				clickedSchema &&
				!usesInlineTextSelection(clickedSchema) &&
				shouldSeedBlockSelection &&
				pointerGestureRef.current.startSelection == null
			) {
				pointerGestureRef.current.startSelection = {
					type: "block",
					blockIds: [blockId],
				};
			}
			const shouldPreserveNativeInlinePointerSelection =
				fieldEditor.isEditing &&
				fieldEditor.focusBlockId === blockId &&
				usesInlineTextSelection(clickedSchema);

			if (interactionModelRef.current.clickToSelect) {
				if (fieldEditor.isEditing && fieldEditor.focusBlockId !== blockId) {
					fieldEditor.deactivate();
				}
			} else if (
				fieldEditor.isEditing &&
				!shouldPreserveNativeInlinePointerSelection
			) {
				flushSync(() => {
					if (
						typeof fieldEditor.suspendForPointerSelection ===
						"function"
					) {
						fieldEditor.suspendForPointerSelection();
					} else {
						fieldEditor.deactivate();
					}
				});
			}
		};

		const handleRootMouseDown = (event: MouseEvent) => {
			const target = event.target;
			if (target instanceof Node && gestureEl.contains(target)) {
				return;
			}
			handleMouseDown(event);
		};

		const handleMouseMove = (event: MouseEvent) => {
			const gesture = regionGestureRef.current;
			if (gesture) {
				const config = regionSelectionStore.getSnapshot().config;
				if (!blockSelection.enabled || !config?.enabled) {
					clearRegionSelectionState();
					return;
				}

				const moved =
					Math.abs(event.clientX - gesture.clientX) > config.threshold ||
					Math.abs(event.clientY - gesture.clientY) > config.threshold;
				if (!gesture.isSelecting && !moved) {
					return;
				}

				if (!gesture.isSelecting) {
					gesture.isSelecting = true;
					skipNextClickRef.current = true;
					gestureEl.ownerDocument?.getSelection()?.removeAllRanges();
				}

				event.preventDefault();

				const liveRect = createClientRect(
					gesture.clientX,
					gesture.clientY,
					event.clientX,
					event.clientY,
				);
				const boundedRect = intersectRegionSelectionRect(
					liveRect,
					resolveRegionRect(config),
				);
				regionSelectionStore.setLiveRect(boundedRect);

				const selectedIds = boundedRect ? getIntersectedBlockIds(boundedRect) : [];
				if (selectedIds.length > 0) {
					editor.selectBlocks(selectedIds);
				} else {
					editor.setSelection(null);
				}
				fieldEditor.deactivate();
				return;
			}

			const pointerGesture = pointerGestureRef.current;
			if (!pointerGesture) {
				return;
			}

			const root = gestureEl.closest(
				"[data-pen-editor-root]",
			) as HTMLElement | null;
			if (!root) {
				return;
			}

			const moved =
				Math.abs(event.clientX - pointerGesture.clientX) > 3 ||
				Math.abs(event.clientY - pointerGesture.clientY) > 3;
			if (!moved) {
				return;
			}

			const resolvedSelection = resolvePointerDragSelection(
				editor,
				root,
				pointerGesture,
				{
					clientX: event.clientX,
					clientY: event.clientY,
					getBoundaryPoint,
				},
			);
			if (!resolvedSelection) {
				return;
			}

			if (resolvedSelection.mode !== "block") {
				pointerGesture.anchorPoint = resolvedSelection.anchorPoint;
			}

			pointerGesture.promotedDuringDrag = true;
			skipNextClickRef.current = true;
			if (resolvedSelection.mode === "block") {
				if (!blockSelection.enabled) return;
				editor.selectBlocks(resolvedSelection.blockIds);
				fieldEditor.deactivate();
				return;
			}

			if (resolvedSelection.mode === "mapped-text") {
				fieldEditor.applyDocumentTextSelection(
					resolvedSelection.anchorPoint,
					resolvedSelection.focusPoint,
				);
				return;
			}

			activateCanonicalSelection(
				resolvedSelection.anchorPoint,
				resolvedSelection.focusPoint,
			);
		};

		const handleMouseUp = (event: MouseEvent) => {
			const regionGesture = regionGestureRef.current;
			if (regionGesture) {
				const wasSelecting = regionGesture.isSelecting;
				const root = gestureEl.closest(
					"[data-pen-editor-root]",
				) as HTMLElement | null;
				if (wasSelecting) {
					if (!blockSelection.enabled) {
						skipNextClickRef.current = true;
						clearRegionSelectionState();
						return;
					}
					const liveRect = createClientRect(
						regionGesture.clientX,
						regionGesture.clientY,
						event.clientX,
						event.clientY,
					);
					const config = regionSelectionStore.getSnapshot().config;
					const boundedRect = intersectRegionSelectionRect(
						liveRect,
						resolveRegionRect(config),
					);
					const selectedIds = boundedRect
						? getIntersectedBlockIds(boundedRect)
						: [];
					if (selectedIds.length > 0) {
						editor.selectBlocks(selectedIds);
						if (root) {
							ensureEditorFocus(root);
						}
					} else {
						editor.setSelection(null);
					}
					skipNextClickRef.current = true;
				}
				clearRegionSelectionState();
				if (wasSelecting) {
					return;
				}
			}

			const gesture = pointerGestureRef.current;
			if (!gesture) return;
			const gestureVersion = pointerGestureVersionRef.current;
			clearPointerSelectionState();

			const clickCount = event.detail;
			const clientX = event.clientX;
			const clientY = event.clientY;
			const moved =
				Math.abs(clientX - gesture.clientX) > 3 ||
				Math.abs(clientY - gesture.clientY) > 3;
			const root = gestureEl.closest(
				"[data-pen-editor-root]",
			) as HTMLElement | null;

			const commitCanonicalSelection = (
				anchorPoint: { blockId: string; offset: number },
				focusPoint: { blockId: string; offset: number },
			) => {
				activateCanonicalSelection(anchorPoint, focusPoint);
				if (root) {
					ensureEditorFocus(root);
				}
				skipNextClickRef.current = true;
			};

			const isSelectionForward = (
				anchorPoint: { blockId: string; offset: number },
				focusPoint: { blockId: string; offset: number },
			): boolean => {
				const blockOrder = editor.documentState.blockOrder;
				const anchorIdx = blockOrder.indexOf(anchorPoint.blockId);
				const focusIdx = blockOrder.indexOf(focusPoint.blockId);
				if (anchorIdx === focusIdx) {
					return anchorPoint.offset <= focusPoint.offset;
				}
				return anchorIdx <= focusIdx;
			};

			const isExpandedSingleBlockTextSelection = (
				selection: ReturnType<Editor["getSelection"]>,
			): boolean =>
				selection?.type === "text" &&
				!selection.isCollapsed &&
				!selection.isMultiBlock &&
				selection.anchor.blockId === selection.focus.blockId;

			const shouldPreferNativeInlineSelection = (
				anchorPoint: { blockId: string; offset: number },
				focusPoint: { blockId: string; offset: number },
			): boolean => {
				const anchorRole = getEditorBlockSelectionRole(
					editor,
					anchorPoint.blockId,
				);
				const focusRole = getEditorBlockSelectionRole(editor, focusPoint.blockId);
				return (
					anchorRole === "editable-inline" &&
					focusRole === "editable-inline"
				);
			};

			const commitMappedTextSelection = (
				anchorPoint: { blockId: string; offset: number },
				focusPoint: { blockId: string; offset: number },
			): true => {
				if (anchorPoint.blockId !== focusPoint.blockId) {
					fieldEditor.applyDocumentTextSelection(anchorPoint, focusPoint);
					return true;
				}

				if (shouldPreferNativeInlineSelection(anchorPoint, focusPoint)) {
					fieldEditor.applyDomTextSelection(anchorPoint, focusPoint);
					return true;
				}

				commitCanonicalSelection(anchorPoint, focusPoint);
				return true;
			};

			const tryHandleMappedDomSelection = (): boolean => {
				if (!root) {
					return false;
				}

				const startedWithExpandedTextSelection =
					gesture.startSelection?.type === "text" &&
					!gesture.startSelection.isCollapsed;
				if (clickCount === 1 && !moved && startedWithExpandedTextSelection) {
					const pointerPoint = pointToEditorSelectionPoint(
						root,
						clientX,
						clientY,
					);
					if (pointerPoint) {
						fieldEditor.collapseSelectionToPoint(pointerPoint);
						return true;
					}
				}

				const mappedSelection = domSelectionToEditor(root);
				if (!mappedSelection) {
					return false;
				}

				const startedWithExpandedSingleBlockTextSelection =
					isExpandedSingleBlockTextSelection(gesture.startSelection);
				const hasExpandedSingleBlockTextSelectionAtMouseUp =
					startedWithExpandedSingleBlockTextSelection ||
					isExpandedSingleBlockTextSelection(editor.selection) ||
					(mappedSelection.anchor.blockId === mappedSelection.focus.blockId &&
						(mappedSelection.anchor.offset !== mappedSelection.focus.offset));

				if (
					(clickCount === 1 || clickCount >= 4) &&
					hasExpandedSingleBlockTextSelectionAtMouseUp &&
					!moved &&
					mappedSelection.anchor.blockId === mappedSelection.focus.blockId &&
					shouldPreferNativeInlineSelection(
						mappedSelection.anchor,
						mappedSelection.focus,
					)
				) {
					const pointerPoint = pointToEditorSelectionPoint(
						root,
						clientX,
						clientY,
					);
					if (pointerPoint) {
						fieldEditor.collapseSelectionToPoint(pointerPoint);
						return true;
					}
				}

				const collapsed =
					mappedSelection.anchor.blockId === mappedSelection.focus.blockId &&
					mappedSelection.anchor.offset === mappedSelection.focus.offset;

				if (!collapsed) {
					const focusBlockEl = root.querySelector(
						`[data-block-id="${mappedSelection.focus.blockId}"]`,
					) as HTMLElement | null;
					const focusRole =
						focusBlockEl?.getAttribute(DATA_ATTRS.surfaceRole) ?? null;
					const focusType = focusBlockEl?.getAttribute("data-block-type");
					const needsBoundarySnap =
						focusRole === "structural" ||
						focusRole === "delegated" ||
						focusType === "divider" ||
						focusType === "image" ||
						focusType === "codeBlock" ||
						focusType === "table" ||
						focusType === "database";

					if (needsBoundarySnap) {
						const selectingForward = isSelectionForward(
							mappedSelection.anchor,
							mappedSelection.focus,
						);
						const snappedPoint = pointToEditorSelectionPoint(
							root,
							clientX,
							clientY,
							{
								preferredBoundary: selectingForward ? "end" : "start",
							},
						);
						commitCanonicalSelection(
							mappedSelection.anchor,
							snappedPoint ?? mappedSelection.focus,
						);
						return true;
					}

					return commitMappedTextSelection(
						mappedSelection.anchor,
						mappedSelection.focus,
					);
				}

				if (startedWithExpandedTextSelection && clickCount < 3) {
					return commitMappedTextSelection(
						mappedSelection.anchor,
						mappedSelection.focus,
					);
				}

				const startedFromFallbackBlock =
					getEditorBlockSelectionRole(editor, gesture.blockId) !==
					"editable-inline" &&
					shouldFallbackMixedSelectionToBlock(
						editor.documentProfile,
						getEditorFlowCapability(editor, gesture.blockId),
					);
				if (moved && collapsed && startedFromFallbackBlock) {
					return false;
				}

				if (moved) {
					return commitMappedTextSelection(
						mappedSelection.anchor,
						mappedSelection.focus,
					);
				}

				return false;
			};

			const tryHandleDraggedPointerSelection = (): boolean => {
				if (!root || !moved) {
					return false;
				}

				const resolvedSelection = resolvePointerDragSelection(editor, root, gesture, {
					clientX,
					clientY,
					getBoundaryPoint,
				});
				if (!resolvedSelection) {
					return false;
				}

				if (resolvedSelection.mode === "block") {
					if (!blockSelection.enabled) return false;
					editor.selectBlocks(resolvedSelection.blockIds);
					fieldEditor.deactivate();
					if (root) {
						ensureEditorFocus(root);
					}
					skipNextClickRef.current = true;
					return true;
				}

				if (resolvedSelection.mode === "mapped-text") {
					return commitMappedTextSelection(
						resolvedSelection.anchorPoint,
						resolvedSelection.focusPoint,
					);
				}

				commitCanonicalSelection(
					resolvedSelection.anchorPoint,
					resolvedSelection.focusPoint,
				);
				return true;
			};

			const tryHandleDraggedBlockSelection = (): boolean => {
				if (!root || !moved) {
					return false;
				}

				const resolvedSelection = resolvePointerDragSelection(editor, root, gesture, {
					clientX,
					clientY,
					getBoundaryPoint,
				});
				if (resolvedSelection?.mode !== "block") {
					return false;
				}
				if (!blockSelection.enabled) {
					return false;
				}

				editor.selectBlocks(resolvedSelection.blockIds);
				fieldEditor.deactivate();
				ensureEditorFocus(root);
				skipNextClickRef.current = true;
				return true;
			};

			const tryHandleCellSelection = (blockId: string): boolean => {
				const cellCoord = resolveClickedCellCoord(event, blockId);
				if (!cellCoord) {
					return false;
				}

				if (clickCount >= 2) {
					fieldEditor.activateCell?.(blockId, cellCoord.row, cellCoord.col);
					skipNextClickRef.current = true;
					return true;
				}

				if (
					isRepeatedCellSelection({
						startSelection: gesture.startSelection,
						selection: editor.selection,
						blockId,
						cellCoord,
					})
				) {
					if (!blockSelection.enabled) {
						editor.selectCell(blockId, cellCoord.row, cellCoord.col);
						skipNextClickRef.current = true;
						return true;
					}
					editor.selectBlock(blockId);
					if (root) {
						ensureEditorFocus(root);
					}
					skipNextClickRef.current = true;
					return true;
				}

				editor.selectCell(blockId, cellCoord.row, cellCoord.col);
				skipNextClickRef.current = true;
				return true;
			};

			const tryHandleBlockSelection = (
				blockId: string,
				blockType: string,
			): boolean => {
				const schema = editor.schema.resolve(blockType);
				const blockPointerIntent = resolveBlockPointerIntent({
					blockId,
					clickCount,
					moved,
					schema,
					startSelection: gesture.startSelection,
					selection: editor.selection,
					interactionModel: interactionModelRef.current,
				});

				if (blockPointerIntent === "select-block-text") {
					const blockStart = getBoundaryPoint(blockId, "start");
					const blockEnd = getBoundaryPoint(blockId, "end");
					commitCanonicalSelection(blockStart, blockEnd);
					return true;
				}

				if (blockPointerIntent === "enter-edit") {
					if (usesInlineTextSelection(schema)) {
						const pointerPoint = root
							? pointToEditorSelectionPoint(root, clientX, clientY)
							: null;
						if (pointerPoint) {
							activateCanonicalSelection(pointerPoint, pointerPoint);
						} else {
							fieldEditor.activate(blockId);
						}
						skipNextClickRef.current = true;
						return true;
					}

					if (!blockSelection.enabled) {
						return false;
					}
					editor.selectBlock(blockId);
					skipNextClickRef.current = true;
					return true;
				}

				if (blockPointerIntent === "select-block") {
					if (!blockSelection.enabled) {
						return false;
					}
					editor.selectBlock(blockId);
					fieldEditor.deactivate();
					if (root) {
						ensureEditorFocus(root);
					}
					skipNextClickRef.current = true;
					return true;
				}

				if (!root) {
					fieldEditor.activate(blockId);
					skipNextClickRef.current = true;
					return true;
				}

				const pointerPoint = pointToEditorSelectionPoint(root, clientX, clientY);
				if (!pointerPoint) {
					fieldEditor.activate(blockId);
					skipNextClickRef.current = true;
					return true;
				}

				activateCanonicalSelection(pointerPoint, pointerPoint);
				skipNextClickRef.current = true;
				return true;
			};

			const finalizePointerSelection = () => {
				if (gestureVersion !== pointerGestureVersionRef.current) {
					return;
				}

				if (gesture.promotedDuringDrag) {
					if (root) {
						ensureEditorFocus(root);
					}
					skipNextClickRef.current = true;
					return;
				}

				if (tryHandleDraggedBlockSelection()) {
					return;
				}

				if (tryHandleMappedDomSelection()) {
					return;
				}

				if (tryHandleDraggedPointerSelection()) {
					return;
				}

				const blockId = resolveClickedBlockId(event) ?? gesture.blockId;
				if (!blockId) {
					if (handleClickOutsideBlocks(event)) {
						skipNextClickRef.current = true;
					}
					return;
				}

				if (
					blockSelection.enabled &&
					moved &&
					gesture.blockId !== blockId &&
					getEditorBlockSelectionRole(editor, gesture.blockId) !==
					"editable-inline" &&
					shouldFallbackMixedSelectionToBlock(
						editor.documentProfile,
						getEditorFlowCapability(editor, gesture.blockId),
					)
				) {
					const blockIds = getBlockIdRange(gesture.blockId, blockId);
					if (blockIds) {
						editor.selectBlocks(blockIds);
						fieldEditor.deactivate();
						if (root) {
							ensureEditorFocus(root);
						}
						skipNextClickRef.current = true;
						return;
					}
				}

				const block = editor.getBlock(blockId);
				if (!block) return;

				if (tryHandleCellSelection(blockId)) {
					return;
				}

				tryHandleBlockSelection(blockId, block.type);
			};

			const completePointerSelection = () => {
				try {
					finalizePointerSelection();
				} finally {
					fieldEditor.endPointerSelection();
				}
			};

			if (clickCount > 1) {
				requestAnimationFrame(completePointerSelection);
				return;
			}

			completePointerSelection();
		};

		gestureEl.addEventListener("mousedown", handleMouseDown, true);
		currentEditorRoot?.addEventListener("mousedown", handleRootMouseDown);
		gestureEl.addEventListener("click", handleClick);
		gestureEl.ownerDocument?.addEventListener("mousemove", handleMouseMove);
		gestureEl.ownerDocument?.addEventListener("mouseup", handleMouseUp);
		return () => {
			gestureEl.removeEventListener("mousedown", handleMouseDown, true);
			currentEditorRoot?.removeEventListener("mousedown", handleRootMouseDown);
			gestureEl.removeEventListener("click", handleClick);
			gestureEl.ownerDocument?.removeEventListener(
				"mousemove",
				handleMouseMove,
			);
			gestureEl.ownerDocument?.removeEventListener(
				"mouseup",
				handleMouseUp,
			);
			if (pointerGestureRef.current) {
				fieldEditor.endPointerSelection();
				clearPointerSelectionState();
			}
			clearRegionSelectionState();
		};
	}, [blockSelection.enabled, editor, fieldEditor, readonly, regionSelectionStore]);

	const blockElements: React.ReactElement[] = [];
	const previewBlocks = visibleSuggestion?.previewBlocks ?? [];
	const anchorBlock = visibleSuggestion
		? editor.getBlock(visibleSuggestion.blockId)
		: null;
	for (const contentItem of contentItems) {
		if (contentItem.kind === "block") {
			blockElements.push(
				<EditorBlock key={contentItem.blockId} blockId={contentItem.blockId} />,
			);
			if (
				previewBlocks.length > 0 &&
				contentItem.blockId === visibleSuggestion?.blockId
			) {
				const previewBlockElements = previewBlocks.map((previewBlock, previewIndex) => (
					<AutocompletePreviewBlock
						key={`autocomplete-preview:${previewBlock.id}`}
						anchorBlock={anchorBlock}
						anchorBlockType={anchorBlock?.type}
						anchorProps={anchorBlock?.props ?? null}
						block={previewBlock}
						previewIndex={previewIndex}
					/>
				));
				blockElements.push(...previewBlockElements);
			}
			continue;
		}
		blockElements.push(
			<div
				key={`virtual-target:${contentItem.target.blockId}`}
				data-pen-ai-structured-virtual-target=""
				data-block-type={contentItem.target.targetKind}
				data-plan-state={contentItem.planState}
				{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			>
				<AIStructuredTargetPreviewItem target={contentItem.target} />
			</div>,
		);
	}

	const inlineDropCaret =
		isDropActive && inlineDropCaretStyle ? (
			<div
				aria-hidden="true"
				{...{ [DATA_ATTRS.dropCaret]: "" }}
				style={{
					left: `${inlineDropCaretStyle.left}px`,
					top: `${inlineDropCaretStyle.top}px`,
					height: `${inlineDropCaretStyle.height}px`,
				}}
			/>
		) : null;

	const handleBlockDragOver = (event: React.DragEvent<HTMLElement>) => {
		if (readonly || !blockDragAndDrop.enabled || !blocksHostRef.current) {
			return;
		}

		const draggedBlockIds = resolveDraggedBlockIdsFromEvent(
			event.dataTransfer,
			blockDragSession.viewId,
			blockDragSession.draggedRef.current?.blockIds ?? null,
		);
		if (!draggedBlockIds) {
			return;
		}

		const target = resolveBlockDropTarget({
			blockIds,
			blocksHost: blocksHostRef.current,
			draggedBlockIds,
			clientY: event.clientY,
		});
		event.preventDefault();
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = "move";
		}
		if (!target) {
			blockDragSession.clearDropTarget();
			return;
		}
		blockDragSession.setDropTarget(target.blockId, target.position);
	};

	const handleBlockDrop = (event: React.DragEvent<HTMLElement>) => {
		if (readonly || !blockDragAndDrop.enabled || !blocksHostRef.current) {
			return;
		}

		const draggedBlockIds = resolveDraggedBlockIdsFromEvent(
			event.dataTransfer,
			blockDragSession.viewId,
			blockDragSession.draggedRef.current?.blockIds ?? null,
		);
		if (!draggedBlockIds) {
			return;
		}

		const target = resolveBlockDropTarget({
			blockIds,
			blocksHost: blocksHostRef.current,
			draggedBlockIds,
			clientY: event.clientY,
		});
		if (!target) {
			blockDragSession.clearDropTarget();
			blockDragSession.endDrag();
			return;
		}

		const moveOps = buildMoveBlockOps({
			blockIds: draggedBlockIds,
			targetBlockId: target.blockId,
			dropPosition: target.position,
		});
		if (
			moveOps.length === 0 ||
			isNoOpBlockMove(editor.documentState.blockOrder, moveOps)
		) {
			blockDragSession.clearDropTarget();
			blockDragSession.endDrag();
			return;
		}

		event.preventDefault();
		editor.apply(moveOps, { origin: "user" });
		blockDragSession.clearDropTarget();
		blockDragSession.endDrag();
	};

	const handleBlockDragLeave = (event: React.DragEvent<HTMLElement>) => {
		const relatedTarget = event.relatedTarget;
		if (
			relatedTarget instanceof Node &&
			event.currentTarget.contains(relatedTarget)
		) {
			return;
		}
		blockDragSession.clearDropTarget();
	};

	const contentChildren = (
		<>
			<div
				data-pen-editor-blocks-host=""
				{...(fieldEditorState.mode === "expanded"
					? {
						[DATA_ATTRS.fieldEditorSurface]: "",
						...fieldEditorTextEntryAttrs(true),
					}
					: {})}
				ref={blocksHostRef}
			>
				{blockElements}
			</div>
			{inlineDropCaret}
			{rest.children}
		</>
	);

	const primitiveProps: Record<string, unknown> = {
		[DATA_ATTRS.editorContent]: "",
		[DATA_ATTRS.dropTarget]: isDropActive || undefined,
		[DATA_ATTRS.empty]: isEmpty || undefined,
		onDragOver: handleBlockDragOver,
		onDrop: handleBlockDrop,
		onDragLeave: handleBlockDragLeave,
	};

	return (
		<EditorContentContext.Provider
			value={{ emptyPlaceholder, isEmpty: isDocumentPlaceholderVisible }}
		>
			<DropPreviewProvider value={dropPreview}>
				{renderAsChild(
					{
						...rest,
						ref: contentRef,
						children: contentChildren,
					},
					"div",
					primitiveProps,
				)}
			</DropPreviewProvider>
		</EditorContentContext.Provider>
	);
}

function createClientRect(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
): RegionSelectionRect {
	const left = Math.min(startX, endX);
	const top = Math.min(startY, endY);
	return {
		left,
		top,
		width: Math.abs(endX - startX),
		height: Math.abs(endY - startY),
	};
}

function rectsIntersect(
	selectionRect: RegionSelectionRect,
	blockRect: DOMRect,
): boolean {
	const selectionRight = selectionRect.left + selectionRect.width;
	const selectionBottom = selectionRect.top + selectionRect.height;

	return !(
		selectionRight < blockRect.left ||
		selectionRect.left > blockRect.right ||
		selectionBottom < blockRect.top ||
		selectionRect.top > blockRect.bottom
	);
}

function pointWithinRect(x: number, y: number, rect: DOMRect): boolean {
	return (
		x >= rect.left &&
		x <= rect.right &&
		y >= rect.top &&
		y <= rect.bottom
	);
}

function resolveDraggedBlockIdsFromEvent(
	dataTransfer: DataTransfer | null,
	viewId: string,
	sessionBlockIds: readonly string[] | null,
): readonly string[] | null {
	const dragTypes = dataTransfer ? Array.from(dataTransfer.types ?? []) : [];
	if (dragTypes.includes(BLOCK_DRAG_MIME)) {
		const payload = parseBlockDragPayload(
			dataTransfer?.getData(BLOCK_DRAG_MIME) ?? "",
		);
		if (payload?.viewId === viewId) {
			return payload.blockIds;
		}
	}

	return sessionBlockIds;
}

function resolveBlockDropTarget(args: {
	blockIds: readonly string[];
	blocksHost: HTMLElement;
	draggedBlockIds: readonly string[];
	clientY: number;
}): { blockId: string; position: BlockDropPosition } | null {
	const draggedBlockIdSet = new Set(args.draggedBlockIds);
	const candidateRects = args.blockIds
		.filter((blockId) => !draggedBlockIdSet.has(blockId))
		.map((blockId) => {
			const element = args.blocksHost.querySelector(
				`[${DATA_ATTRS.editorBlock}][${DATA_ATTRS.blockId}="${blockId}"]`,
			) as HTMLElement | null;
			if (!element) {
				return null;
			}
			return {
				blockId,
				rect: element.getBoundingClientRect(),
			};
		})
		.filter(
			(
				candidate,
			): candidate is { blockId: string; rect: DOMRect } => candidate !== null,
		);

	if (candidateRects.length === 0) {
		return null;
	}

	let bestTarget: {
		blockId: string;
		position: BlockDropPosition;
		distance: number;
	} | null = null;

	for (const candidate of candidateRects) {
		const { rect } = candidate;
		const isWithinBlock = args.clientY >= rect.top && args.clientY <= rect.bottom;
		const beforeDistance = Math.abs(args.clientY - rect.top);
		const afterDistance = Math.abs(args.clientY - rect.bottom);
		const position =
			isWithinBlock && args.clientY <= rect.top + rect.height / 2
				? "before"
				: isWithinBlock && args.clientY > rect.top + rect.height / 2
					? "after"
					: beforeDistance <= afterDistance
						? "before"
						: "after";
		const distance =
			position === "before" ? beforeDistance : afterDistance;

		if (!bestTarget || distance < bestTarget.distance) {
			bestTarget = {
				blockId: candidate.blockId,
				position,
				distance,
			};
		}
	}

	return bestTarget
		? { blockId: bestTarget.blockId, position: bestTarget.position }
		: null;
}

function isNoOpBlockMove(
	blockOrder: readonly string[],
	moveOps: readonly MoveBlockOp[],
): boolean {
	const initialOrder = [...blockOrder];
	const nextOrder = [...blockOrder];

	for (const op of moveOps) {
		const currentIndex = nextOrder.indexOf(op.blockId);
		if (currentIndex < 0) {
			continue;
		}
		nextOrder.splice(currentIndex, 1);

		const { position } = op;
		if (typeof position === "object" && "before" in position) {
			const targetIndex = nextOrder.indexOf(position.before);
			if (targetIndex < 0) {
				nextOrder.push(op.blockId);
			} else {
				nextOrder.splice(targetIndex, 0, op.blockId);
			}
			continue;
		}

		if (typeof position !== "object" || !("after" in position)) {
			continue;
		}

		const targetIndex = nextOrder.indexOf(position.after);
		if (targetIndex < 0) {
			nextOrder.push(op.blockId);
		} else {
			nextOrder.splice(targetIndex + 1, 0, op.blockId);
		}
	}

	return initialOrder.join("\u0000") === nextOrder.join("\u0000");
}
