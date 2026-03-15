import "./SlashMenu.css";
import type { Editor } from "@pen/types";
import { useEffect, useRef, useState } from "react";
import { useSlashMenu, type SlashMenuState } from "@pen/react";

interface SlashMenuProps {
	editor: Editor;
}

interface SlashMenuPosition {
	top: number;
	left: number;
	maxHeight: number;
}

type SlashMenuItemData = SlashMenuState["items"][number];

const EMPTY_RESULTS_MESSAGE = "No matching commands";
const MENU_GAP = 10;
const VIEWPORT_PADDING = 16;
const MIN_MENU_HEIGHT = 120;
const FALLBACK_POSITION: SlashMenuPosition = {
	top: 96,
	left: 0,
	maxHeight: 320,
};
const BLOCK_TYPE_ICONS: Record<string, string> = {
	paragraph: "P",
	heading: "H",
	bulletListItem: "*",
	numberedListItem: "1.",
	checkListItem: "[]",
	blockquote: '"',
	codeBlock: "<>",
	divider: "---",
	callout: "!",
	table: "| |",
	image: "IMG",
	toggle: ">>",
};

function clamp(value: number, min: number, max: number) {
	return Math.min(Math.max(value, min), max);
}

function formatGroupLabel(group?: string) {
	if (!group) return "Other";
	return group
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
		.join(" ");
}

function getItemIcon(item: SlashMenuItemData) {
	return (
		item.display.icon ??
		BLOCK_TYPE_ICONS[item.type] ??
		item.display.title.slice(0, 2).toUpperCase()
	);
}

function getSlashQuery(editor: Editor) {
	const selection = editor.selection;
	if (selection?.type !== "text") return null;

	const isCollapsed =
		selection.anchor.blockId === selection.focus.blockId &&
		selection.anchor.offset === selection.focus.offset;
	if (!isCollapsed) return null;

	const block = editor.getBlock(selection.anchor.blockId);
	const text = block?.textContent() ?? "";
	if (!text.startsWith("/")) return null;

	return text.slice(1);
}

function getAnchorRect(editor: Editor) {
	if (typeof window === "undefined") return null;

	const domSelection = window.getSelection();
	if (domSelection?.rangeCount) {
		const range = domSelection.getRangeAt(0).cloneRange();
		range.collapse(false);

		const rect =
			Array.from(range.getClientRects()).at(-1) ?? range.getBoundingClientRect();
		if (rect.width > 0 || rect.height > 0) {
			return rect;
		}
	}

	const editorSelection = editor.selection;
	if (editorSelection?.type !== "text") return null;

	const blockElement = document.querySelector<HTMLElement>(
		`[data-block-id="${editorSelection.anchor.blockId}"]`,
	);
	return blockElement?.getBoundingClientRect() ?? null;
}

export function SlashMenu({ editor }: SlashMenuProps) {
	const { open, query, items, selectedIndex, setQuery, select, confirm, dismiss } =
		useSlashMenu(editor);

	const menuRef = useRef<HTMLDivElement | null>(null);
	const [position, setPosition] = useState<SlashMenuPosition>(FALLBACK_POSITION);

	const groupedItems = new Map<
		string,
		Array<{ index: number; item: SlashMenuItemData }>
	>();
	items.forEach((item, index) => {
		const groupLabel = formatGroupLabel(item.display.group);
		const groupEntries = groupedItems.get(groupLabel) ?? [];
		groupEntries.push({ item, index });
		groupedItems.set(groupLabel, groupEntries);
	});

	const slashMenuGroups = Array.from(groupedItems.entries()).map(
		([groupLabel, groupItems]) => {
			const groupItemElements = groupItems.map(({ item, index }) => {
				const itemAlias = item.display.aliases?.[0];
				const isSelected = index === selectedIndex;

				return (
					<button
						key={item.type}
						type="button"
						data-pen-slash-menu-item=""
						data-selected={isSelected || undefined}
						data-block-type={item.type}
						role="option"
						aria-selected={isSelected}
						onMouseDown={(event) => event.preventDefault()}
						onClick={() => confirm(index)}
						onMouseEnter={() => select(index)}
					>
						<span className="slash-menu-item-icon" aria-hidden="true">
							{getItemIcon(item)}
						</span>
						<span className="slash-menu-item-content">
							<span className="slash-menu-item-title">{item.display.title}</span>
							<span className="slash-menu-item-description">
								{item.display.description ?? "Insert this block"}
							</span>
						</span>
						{itemAlias ? (
							<span className="slash-menu-item-alias" aria-hidden="true">
								/{itemAlias}
							</span>
						) : null}
					</button>
				);
			});

			return (
				<div key={groupLabel} data-pen-slash-menu-group="" role="group" aria-label={groupLabel}>
					<div data-pen-slash-menu-group-heading="" role="presentation">
						{groupLabel}
					</div>
					{groupItemElements}
				</div>
			);
		},
	);

	const menuStyle = {
		top: `${position.top}px`,
		left: `${position.left}px`,
		maxHeight: `${position.maxHeight}px`,
	};

	function updatePosition() {
		const anchorRect = getAnchorRect(editor);
		if (!anchorRect) return;

		const menuWidth = menuRef.current?.offsetWidth ?? 320;
		const nextLeft = clamp(
			anchorRect.left - 14,
			VIEWPORT_PADDING,
			window.innerWidth - menuWidth - VIEWPORT_PADDING,
		);
		const nextTop = anchorRect.bottom + MENU_GAP;
		const availableHeight =
			window.innerHeight - nextTop - VIEWPORT_PADDING;

		setPosition({
			top: nextTop,
			left: nextLeft,
			maxHeight: Math.max(MIN_MENU_HEIGHT, availableHeight),
		});
	}

	useEffect(() => {
		if (!open) return;

		const syncQueryFromEditor = () => {
			const nextQuery = getSlashQuery(editor);
			if (nextQuery === null) {
				dismiss();
				return;
			}
			setQuery(nextQuery);
		};

		syncQueryFromEditor();
		const unsubscribeDocument = editor.onDocumentCommit(syncQueryFromEditor);
		const unsubscribeSelection = editor.onSelectionChange(syncQueryFromEditor);

		return () => {
			unsubscribeDocument();
			unsubscribeSelection();
		};
	}, [dismiss, editor, open, setQuery]);

	useEffect(() => {
		if (!open) return;

		const syncPosition = () => {
			window.requestAnimationFrame(updatePosition);
		};

		syncPosition();
		window.addEventListener("resize", syncPosition);
		window.addEventListener("scroll", syncPosition, true);
		document.addEventListener("selectionchange", syncPosition);

		return () => {
			window.removeEventListener("resize", syncPosition);
			window.removeEventListener("scroll", syncPosition, true);
			document.removeEventListener("selectionchange", syncPosition);
		};
	}, [editor, open, query, items.length]);

	useEffect(() => {
		if (!open) return;

		const handleKeyDown = (event: KeyboardEvent) => {
			switch (event.key) {
				case "ArrowDown":
					event.preventDefault();
					select(selectedIndex + 1);
					break;
				case "ArrowUp":
					event.preventDefault();
					select(selectedIndex - 1);
					break;
				case "Enter":
					event.preventDefault();
					confirm();
					break;
				case "Escape":
					event.preventDefault();
					dismiss();
					break;
			}
		};

		document.addEventListener("keydown", handleKeyDown, true);
		return () => {
			document.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [confirm, dismiss, open, select, selectedIndex]);

	useEffect(() => {
		if (!open) return;

		const handlePointerDown = (event: MouseEvent) => {
			if (menuRef.current?.contains(event.target as Node)) return;
			dismiss();
		};

		document.addEventListener("mousedown", handlePointerDown, true);
		return () => {
			document.removeEventListener("mousedown", handlePointerDown, true);
		};
	}, [dismiss, open]);

	useEffect(() => {
		if (!open) return;

		const selectedItemElement = menuRef.current?.querySelector<HTMLElement>(
			"[data-pen-slash-menu-item][data-selected]",
		);
		selectedItemElement?.scrollIntoView({ block: "nearest" });
	}, [open, selectedIndex]);

	if (!open) return null;

	return (
		<div
			ref={menuRef}
			data-pen-slash-menu=""
			data-open=""
			role="dialog"
			aria-label="Insert block"
			style={menuStyle}
		>
			<div id="playground-slash-menu-list" data-pen-slash-menu-list="" role="listbox">
				{slashMenuGroups.length > 0 ? (
					slashMenuGroups
				) : (
					<div data-pen-slash-menu-empty="" role="presentation">
						{EMPTY_RESULTS_MESSAGE}
					</div>
				)}
			</div>
		</div>
	);
}
