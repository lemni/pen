import { useState, useRef, useEffect } from "react";
import { generateId, type Editor, type BlockDisplay, type BlockSchema } from "@pen/core";
import { getAttachedFieldEditor } from "../utils/fieldEditor";
import { getConvertBlockOps } from "../field-editor/commands";
import { getInsertSiblingBlockOp } from "../utils/parentIdTree";
import {
	shouldShowBlockInDefaultMenus,
} from "../utils/flowCapabilities";
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
}

export interface SlashMenuActions {
	setQuery: (q: string) => void;
	select: (index: number) => void;
	confirm: (index?: number) => void;
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
	});
	const editorRef = useRef(editor);
	editorRef.current = editor;

	const allDisplays = editor.schema.allBlockDisplays();
	const allDisplaysRef = useRef(allDisplays);
	allDisplaysRef.current = allDisplays;

	useEffect(() => {
		const syncSlashMenu = () => {
			const query = getSlashQuery(editorRef.current);
			if (query == null) {
				setState((prev) =>
					prev.open
						? { open: false, query: "", items: [], selectedIndex: 0 }
						: prev,
				);
				return;
			}

			const items = filterItems(
				allDisplaysRef.current,
				query,
				editorRef.current,
			);
			setState((prev) => ({
				open: true,
				query,
				items,
				selectedIndex:
					items.length === 0
						? 0
						: Math.min(prev.selectedIndex, items.length - 1),
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
		}));
	};

	const select = (index: number) => {
		setState((prev) => ({
			...prev,
			selectedIndex: Math.max(0, Math.min(index, prev.items.length - 1)),
		}));
	};

	const confirm = (index?: number) => {
		const itemIndex = index ?? state.selectedIndex;
		const item = state.items[itemIndex];
		if (!item) return;

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
				const tableProps = isTableInsert ? getStarterTableProps() : undefined;

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
						ed.apply(ops, { origin: "user" });
					}
				} else {
					const newBlockId = generateId();
					ed.apply([
						getInsertSiblingBlockOp(ed, {
							siblingBlockId: blockId,
							blockId: newBlockId,
							blockType: item.type,
							props: tableProps ?? {},
						}),
					]);
					insertedOrConvertedBlockId = newBlockId;
				}

				if (isTableInsert && insertedOrConvertedBlockId && tableActivationTarget) {
					const defaultCols = createDefaultTableColumns(2);
					ed.apply([{
						type: "update-table-columns",
						blockId: insertedOrConvertedBlockId,
						columns: defaultCols,
					}]);
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

		setState({
			open: false,
			query: "",
			items: [],
			selectedIndex: itemIndex,
		});
	};

	const dismiss = () => {
		setState({ open: false, query: "", items: [], selectedIndex: 0 });
	};

	return { ...state, setQuery, select, confirm, dismiss };
}

function getSlashQuery(editor: Editor): string | null {
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

	return text.slice(1);
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
		return visibleDisplays.map((d) => ({ type: d.type, display: d.display }));
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
