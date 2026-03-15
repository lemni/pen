import React, { useSyncExternalStore } from "react";
import { getNumberedListItemValue as getOrderedListValue } from "@pen/core";
import type { BlockHandle, InlineCompletionPreviewBlock } from "@pen/types";
import { useEditorContext } from "../../context/editorContext";
import { DATA_ATTRS } from "../../utils/dataAttributes";

const LIST_ITEM_INDENT_PX = 24;
const LIST_ITEM_COLUMN_GAP_PX = 8;
const LIST_ITEM_CONTENT_MIN_HEIGHT_EM = 1.5;

export interface AutocompletePreviewBlockProps {
	block: InlineCompletionPreviewBlock;
	anchorBlock?: BlockHandle | null;
	anchorBlockType?: string;
	anchorProps?: Record<string, unknown> | null;
	previewIndex?: number;
}

export function AutocompletePreviewBlock(props: AutocompletePreviewBlockProps) {
	const { anchorBlock, anchorBlockType, anchorProps, block, previewIndex = 0 } = props;
	const numberedAnchorValue = usePreviewNumberedListItemValue(anchorBlock);
	const headingLevel =
		block.blockType === "heading" && typeof block.props?.level === "number"
			? block.props.level
			: anchorBlockType === "heading" && typeof anchorProps?.level === "number"
				? anchorProps.level
			: undefined;
	const calloutType =
		block.blockType === "callout" && typeof block.props?.type === "string"
			? block.props.type
			: anchorBlockType === "callout" && typeof anchorProps?.type === "string"
				? anchorProps.type
			: undefined;
	const listPreview = buildListPreview({
		blockType: block.blockType,
		blockProps: block.props,
		anchorBlockType,
		anchorProps,
		numberedAnchorValue,
		previewIndex,
	});
	const surface = (
		<div data-pen-autocomplete-preview-surface="">
			<div data-pen-autocomplete-preview-content="">
				{block.text}
			</div>
		</div>
	);
	const wrappedSurface = wrapSurfaceForAnchorBlock(anchorBlockType, surface);

	if (listPreview) {
		return (
			<div
				className="pen-block-suggestion pen-block-suggestion-insert pen-autocomplete-preview-block"
				data-pen-autocomplete-preview-block=""
				data-block-type={block.blockType ?? "paragraph"}
				data-anchor-block-type={anchorBlockType ?? undefined}
				data-anchor-list-block-type={listPreview.blockType}
				data-anchor-level={headingLevel}
				data-anchor-callout-type={calloutType}
				data-suggestion-action="insert"
				{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
			>
				<div
					data-pen-list-item-layout=""
					data-block-type={listPreview.blockType}
					data-indent={listPreview.indent}
					data-counter={listPreview.counter}
					data-checked={listPreview.checked || undefined}
					style={{
						paddingLeft: `${listPreview.indent * LIST_ITEM_INDENT_PX}px`,
						display: "grid",
						gridTemplateColumns: "max-content minmax(0, 1fr)",
						columnGap: `${LIST_ITEM_COLUMN_GAP_PX}px`,
						alignItems: "start",
					}}
				>
					<div
						data-pen-list-item-marker=""
						style={{
							display: "flex",
							alignItems: "center",
							minHeight: `${LIST_ITEM_CONTENT_MIN_HEIGHT_EM}em`,
						}}
					>
						{listPreview.marker}
					</div>
					<div data-pen-list-item-content="" style={{ minWidth: 0 }}>
						{wrappedSurface}
					</div>
				</div>
			</div>
		);
	}

	return (
		<div
			className="pen-block-suggestion pen-block-suggestion-insert pen-autocomplete-preview-block"
			data-pen-autocomplete-preview-block=""
			data-block-type={block.blockType ?? "paragraph"}
			data-anchor-block-type={anchorBlockType ?? undefined}
			data-anchor-level={headingLevel}
			data-anchor-callout-type={calloutType}
			data-suggestion-action="insert"
			{...{ [DATA_ATTRS.ignorePointerGesture]: "" }}
		>
			{wrappedSurface}
		</div>
	);
}

function buildListPreview(options: {
	blockType?: string;
	blockProps?: Record<string, unknown>;
	anchorBlockType?: string;
	anchorProps?: Record<string, unknown> | null;
	numberedAnchorValue: number | null;
	previewIndex: number;
}): {
	blockType: "bulletListItem" | "numberedListItem" | "checkListItem";
	indent: number;
	counter?: number;
	checked?: boolean;
	marker: React.ReactNode;
} | null {
	const {
		blockType,
		blockProps,
		anchorBlockType,
		anchorProps,
		numberedAnchorValue,
		previewIndex,
	} = options;
	const previewBlockType =
		blockType === "bulletListItem" ||
		blockType === "checkListItem" ||
		blockType === "numberedListItem"
			? blockType
			: anchorBlockType;
	const previewProps =
		previewBlockType === blockType && blockProps ? blockProps : anchorProps;
	const indent = typeof previewProps?.indent === "number" ? previewProps.indent : 0;
	if (previewBlockType === "bulletListItem") {
		return {
			blockType: "bulletListItem",
			indent,
			marker: (
				<span data-pen-list-marker="" aria-hidden="true">
					•
				</span>
			),
		};
	}
	if (previewBlockType === "checkListItem") {
		return {
			blockType: "checkListItem",
			indent,
			checked: false,
			marker: (
				<input
					type="checkbox"
					checked={false}
					readOnly
					disabled
					aria-hidden="true"
					tabIndex={-1}
				/>
			),
		};
	}
	if (previewBlockType === "numberedListItem") {
		const baseCounter =
			previewBlockType === blockType && typeof blockProps?.start === "number"
				? blockProps.start
				: numberedAnchorValue != null
					? numberedAnchorValue + 1
					: 1;
		const counter = baseCounter + previewIndex;
		return {
			blockType: "numberedListItem",
			indent,
			counter,
			marker: (
				<span data-pen-list-marker="" aria-hidden="true">
					{counter}.
				</span>
			),
		};
	}
	return null;
}

function usePreviewNumberedListItemValue(block: BlockHandle | null | undefined): number | null {
	const { editor } = useEditorContext();
	const fallbackValue = block ? getOrderedListValue(block) ?? 1 : null;
	return useSyncExternalStore(
		(callback) => {
			if (!block) {
				return () => { };
			}
			return editor.onDocumentCommit(() => callback());
		},
		() => {
			if (!block) {
				return null;
			}
			return getOrderedListValue(editor.getBlock(block.id)) ?? fallbackValue;
		},
		() => fallbackValue,
	);
}

function wrapSurfaceForAnchorBlock(
	anchorBlockType: string | undefined,
	surface: React.ReactNode,
): React.ReactNode {
	if (anchorBlockType === "toggle") {
		return <div data-pen-toggle-body="">{surface}</div>;
	}
	if (anchorBlockType === "subdocument") {
		return (
			<div data-pen-subdocument-host="" data-pen-autocomplete-preview-subdocument="">
				<div data-pen-subdocument-placeholder="">
					{surface}
				</div>
			</div>
		);
	}
	return surface;
}
