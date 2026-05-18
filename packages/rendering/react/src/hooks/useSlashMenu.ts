import { useState, useRef, useEffect } from "react";
import type { BlockDisplay, BlockSchema, Editor } from "@pen/types";
import { generateId } from "@pen/types";
import { getAttachedFieldEditor } from "../utils/fieldEditor";
import { getConvertBlockOps } from "../field-editor/commands";
import { getInsertSiblingBlockOp } from "../utils/parentIdTree";
import { shouldShowBlockInDefaultMenus } from "../utils/flowCapabilities";
import {
	getStarterTableProps,
	getTableActivationTarget,
	createDefaultTableColumns,
} from "../utils/tableDefaults";

export interface SlashMenuState {
	open: boolean;
	query: string;
	items: Array<{ type: string; display: BlockDisplay }>;
	selectedIndex: number;
	target?: SlashMenuTarget | null;
}

export interface SlashMenuTarget {
	blockId: string;
	startOffset: number;
	endOffset: number;
	query: string;
}

export interface SlashMenuActions {
	setQuery: (q: string) => void;
	select: (index: number) => void;
	confirm: (index?: number) => boolean;
	dismiss: () => void;
}

export function useSlashMenu(
	editor: Editor,
): SlashMenuState & SlashMenuActions {
	const [state, setState] = useState<SlashMenuState>({
		open: false,
		query: "",
		items: [],
		selectedIndex: 0,
		target: null,
	});
	const editorRef = useRef(editor);
	editorRef.current = editor;

	const allDisplays = editor.schema.allBlockDisplays();
	const allDisplaysRef = useRef(allDisplays);
	allDisplaysRef.current = allDisplays;

	useEffect(() => {
		const syncSlashMenu = () => {
			const target = getSlashTarget(editorRef.current);
			if (!target) {
				setState((prev) =>
					prev.open
						? {
								open: false,
								query: "",
								items: [],
								selectedIndex: 0,
								target: null,
							}
						: prev,
				);
				return;
			}

			const items = filterItems(
				allDisplaysRef.current,
				target.query,
				editorRef.current,
			);
			setState((prev) => ({
				open: true,
				query: target.query,
				items,
				selectedIndex:
					items.length === 0
						? 0
						: Math.min(prev.selectedIndex, items.length - 1),
				target,
			}));
		};

		syncSlashMenu();
		const unsubDocument = editor.onDocumentCommit(syncSlashMenu);
		const unsubSelection = editor.onSelectionChange(syncSlashMenu);
		return () => {
			unsubDocument();
			unsubSelection();
		};
	}, [editor]);

	const setQuery = (query: string) => {
		const filtered = filterItems(allDisplays, query, editor);
		setState((prev) => ({
			...prev,
			query,
			items: filtered,
			selectedIndex: 0,
			target: prev.target
				? {
						...prev.target,
						query,
						endOffset: prev.target.startOffset + 1 + query.length,
					}
				: prev.target,
		}));
	};

	const select = (index: number) => {
		setState((prev) => ({
			...prev,
			selectedIndex: Math.max(0, Math.min(index, prev.items.length - 1)),
		}));
	};

	const confirm = (index?: number): boolean => {
		const itemIndex = index ?? state.selectedIndex;
		const item = state.items[itemIndex];
		if (!item) return false;

		const ed = editorRef.current;
		const selection = ed.selection;

		if (selection?.type === "text") {
			const blockId = selection.anchor.blockId;
			const block = ed.getBlock(blockId);
			let insertedOrConvertedBlockId: string | null = null;

			if (block) {
				const currentText = block.textContent();
				const isEmptyOrSlash =
					!currentText ||
					currentText === "/" ||
					currentText === "\u200B";
				const isTableInsert = item.type === "table";
				const tableActivationTarget = isTableInsert
					? getTableActivationTarget(undefined)
					: null;
				const tableProps = isTableInsert
					? getStarterTableProps()
					: undefined;

				if (isEmptyOrSlash) {
					const ops = [];
					if (currentText === "/") {
						ops.push({
							type: "delete-text" as const,
							blockId,
							offset: 0,
							length: 1,
						});
					}
					if (block.type !== item.type) {
						ops.push(
							...getConvertBlockOps(ed, {
								blockId,
								newType: item.type,
								newProps: tableProps,
							}),
						);
						insertedOrConvertedBlockId = blockId;
					}
					if (ops.length > 0) {
						ed.apply(ops, { origin: "user", undoGroup: true });
					}
				} else {
					const newBlockId = generateId();
					ed.apply(
						[
							getInsertSiblingBlockOp(ed, {
								siblingBlockId: blockId,
								blockId: newBlockId,
								blockType: item.type,
								props: tableProps ?? {},
							}),
						],
						{ origin: "user", undoGroup: true },
					);
					insertedOrConvertedBlockId = newBlockId;
				}

				if (
					isTableInsert &&
					insertedOrConvertedBlockId &&
					tableActivationTarget
				) {
					const defaultCols = createDefaultTableColumns(2);
					ed.apply(
						[
							{
								type: "update-table-columns",
								blockId: insertedOrConvertedBlockId,
								columns: defaultCols,
							},
						],
						{ origin: "user", undoGroup: true },
					);
					const fieldEditor = getAttachedFieldEditor(ed);
					const activateStarterTable = () => {
						fieldEditor?.activateCell?.(
							insertedOrConvertedBlockId!,
							tableActivationTarget.row,
							tableActivationTarget.col,
						);
					};
					if (typeof window !== "undefined") {
						window.requestAnimationFrame(activateStarterTable);
					} else {
						activateStarterTable();
					}
				}
			}
		}

		setState(getClosedSlashMenuState());
		return true;
	};

	const dismiss = () => {
		setState(getClosedSlashMenuState());
	};

	return { ...state, setQuery, select, confirm, dismiss };
}

function getSlashTarget(editor: Editor): SlashMenuTarget | null {
	const selection = editor.selection;
	if (!selection || selection.type !== "text" || !selection.isCollapsed) {
		return null;
	}

	if (selection.anchor.blockId !== selection.focus.blockId) {
		return null;
	}

	const block = editor.getBlock(selection.anchor.blockId);
	const text = block?.textContent() ?? "";
	if (!text.startsWith("/")) {
		return null;
	}

	return {
		blockId: selection.anchor.blockId,
		startOffset: 0,
		endOffset: selection.focus.offset,
		query: text.slice(1, selection.focus.offset),
	};
}

function getClosedSlashMenuState(): SlashMenuState {
	return {
		open: false,
		query: "",
		items: [],
		selectedIndex: 0,
		target: null,
	};
}

function filterItems(
	displays: readonly (BlockSchema & {
		display: BlockDisplay;
	})[],
	query: string,
	editor: Editor,
): Array<{ type: string; display: BlockDisplay }> {
	const visibleDisplays = displays.filter((display) =>
		shouldShowBlockInDefaultMenus(editor.documentProfile, display),
	);

	if (!query) {
		return visibleDisplays.map((d) => ({
			type: d.type,
			display: d.display,
		}));
	}

	const lower = query.toLowerCase();
	return visibleDisplays
		.filter((d) => {
			const title = d.display.title.toLowerCase();
			const desc = d.display.description?.toLowerCase() ?? "";
			const aliases = d.display.aliases ?? [];
			return (
				title.includes(lower) ||
				desc.includes(lower) ||
				aliases.some((a) => a.toLowerCase().includes(lower))
			);
		})
		.sort((a: (typeof displays)[number], b: (typeof displays)[number]) => {
			const aPos = a.display.title.toLowerCase().indexOf(lower);
			const bPos = b.display.title.toLowerCase().indexOf(lower);
			return aPos - bPos;
		})
		.map((d) => ({ type: d.type, display: d.display }));
}
