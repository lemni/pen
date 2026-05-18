import type { AppPlacement } from "./block";
import type { SelectionState } from "./selection";
import type { LayoutProps } from "./layout";
import type { ColumnType, DatabaseViewState, SelectOption } from "./database";
import type { TableColumnSchema } from "./handles";

export type OpOriginType =
	| "user"
	| "ai"
	| "ai-session"
	| "suggestion-resolution"
	| "collaborator"
	| "extension"
	| "history"
	| "input-rule"
	| "app"
	| "import"
	| "system";

export interface StructuredOpOrigin {
	type: OpOriginType | (string & {});
	groupId?: string;
	requestId?: string;
	actorId?: string;
	source?: string;
}

export type OpOrigin = OpOriginType | StructuredOpOrigin;

export interface MutationGroupMetadata {
	groupId: string;
	originType: string;
	requestId?: string;
	actorId?: string;
	source?: string;
}

export interface ApplyOptions {
	origin?: OpOrigin;
	undoGroup?: boolean;
	groupId?: string;
	undoGroupId?: string;
}

export const MUTATION_GROUP_METADATA_KEY = "mutation-group";

export function getOpOriginType(origin: OpOrigin): string {
	return typeof origin === "string" ? origin : origin.type;
}

export function getOpOriginGroupId(origin: OpOrigin): string | undefined {
	return typeof origin === "string" ? undefined : origin.groupId;
}

export function getApplyOptionsGroupId(
	origin: OpOrigin,
	options?: Pick<ApplyOptions, "groupId" | "undoGroupId">,
): string | undefined {
	return (
		options?.undoGroupId ?? options?.groupId ?? getOpOriginGroupId(origin)
	);
}

export function createMutationGroupMetadata(
	origin: OpOrigin,
	groupId: string,
): MutationGroupMetadata {
	if (typeof origin === "string") {
		return { groupId, originType: origin };
	}

	return {
		groupId,
		originType: origin.type,
		requestId: origin.requestId,
		actorId: origin.actorId,
		source: origin.source,
	};
}

export type Position =
	| "first"
	| "last"
	| { before: string }
	| { after: string }
	| { parent: string; index: number };

// ── Document Operations ─────────────────────────────────────

export type DocumentOp =
	| InsertBlockOp
	| UpdateBlockOp
	| DeleteBlockOp
	| MoveBlockOp
	| ConvertBlockOp
	| SplitBlockOp
	| MergeBlocksOp
	| InsertTextOp
	| DeleteTextOp
	| FormatTextOp
	| ReplaceTextOp
	| InsertInlineNodeOp
	| RemoveInlineNodeOp
	| UpdateLayoutOp
	| InsertTableRowOp
	| DeleteTableRowOp
	| InsertTableColumnOp
	| DeleteTableColumnOp
	| MergeTableCellsOp
	| SplitTableCellOp
	| InsertTableCellTextOp
	| DeleteTableCellTextOp
	| FormatTableCellTextOp
	| UpdateTableColumnsOp
	| DatabaseAddColumnOp
	| DatabaseUpdateColumnOp
	| DatabaseConvertColumnOp
	| DatabaseRemoveColumnOp
	| DatabaseInsertRowOp
	| DatabaseUpdateCellOp
	| DatabaseDeleteRowOp
	| DatabaseDeleteRowsOp
	| DatabaseDuplicateRowOp
	| DatabaseMoveRowOp
	| DatabaseAddViewOp
	| DatabaseUpdateViewOp
	| DatabaseRemoveViewOp
	| DatabaseSetActiveViewOp
	| DatabaseUpdateSelectOptionsOp
	| SetMetaOp
	| CreateAppOp
	| UpdateAppOp
	| DeleteAppOp
	| SetSelectionOp;

// ── Block ops ───────────────────────────────────────────────

export interface InsertBlockOp {
	type: "insert-block";
	blockId: string;
	blockType: string;
	props: Record<string, unknown>;
	position: Position;
}
export interface UpdateBlockOp {
	type: "update-block";
	blockId: string;
	props: Record<string, unknown>;
}
export interface DeleteBlockOp {
	type: "delete-block";
	blockId: string;
}
export interface MoveBlockOp {
	type: "move-block";
	blockId: string;
	position: Position;
}
export interface ConvertBlockOp {
	type: "convert-block";
	blockId: string;
	newType: string;
	newProps?: Record<string, unknown>;
}
export interface SplitBlockOp {
	type: "split-block";
	blockId: string;
	offset: number;
	newBlockId: string;
	newBlockType?: string;
}
export interface MergeBlocksOp {
	type: "merge-blocks";
	targetBlockId: string;
	sourceBlockId: string;
}

// ── Text ops ────────────────────────────────────────────────

export interface InsertTextOp {
	type: "insert-text";
	blockId: string;
	offset: number;
	text: string;
	marks?: Record<string, unknown | null>;
}
export interface DeleteTextOp {
	type: "delete-text";
	blockId: string;
	offset: number;
	length: number;
}
export interface FormatTextOp {
	type: "format-text";
	blockId: string;
	offset: number;
	length: number;
	marks: Record<string, unknown>;
}
export interface ReplaceTextOp {
	type: "replace-text";
	blockId: string;
	offset: number;
	length: number;
	text: string;
	marks?: Record<string, unknown | null>;
}
export interface InsertInlineNodeOp {
	type: "insert-inline-node";
	blockId: string;
	offset: number;
	nodeType: string;
	props: Record<string, unknown>;
}
export interface RemoveInlineNodeOp {
	type: "remove-inline-node";
	blockId: string;
	offset: number;
}

// ── Layout ops ──────────────────────────────────────────────

export interface UpdateLayoutOp {
	type: "update-layout";
	blockId: string;
	layout: Partial<LayoutProps>;
}

// ── Table ops ───────────────────────────────────────────────

export interface InsertTableRowOp {
	type: "insert-table-row";
	blockId: string;
	index: number;
}
export interface DeleteTableRowOp {
	type: "delete-table-row";
	blockId: string;
	index: number;
}
export interface InsertTableColumnOp {
	type: "insert-table-column";
	blockId: string;
	index: number;
}
export interface DeleteTableColumnOp {
	type: "delete-table-column";
	blockId: string;
	index: number;
}
export interface MergeTableCellsOp {
	type: "merge-table-cells";
	blockId: string;
	anchor: { row: number; col: number };
	head: { row: number; col: number };
}
export interface SplitTableCellOp {
	type: "split-table-cell";
	blockId: string;
	row: number;
	col: number;
}

export interface InsertTableCellTextOp {
	type: "insert-table-cell-text";
	blockId: string;
	row: number;
	col: number;
	offset: number;
	text: string;
}

export interface DeleteTableCellTextOp {
	type: "delete-table-cell-text";
	blockId: string;
	row: number;
	col: number;
	offset: number;
	length: number;
}

export interface FormatTableCellTextOp {
	type: "format-table-cell-text";
	blockId: string;
	row: number;
	col: number;
	offset: number;
	length: number;
	marks: Record<string, unknown>;
}

export interface UpdateTableColumnsOp {
	type: "update-table-columns";
	blockId: string;
	columns: TableColumnSchema[];
}

export interface DatabaseAddColumnOp {
	type: "database-add-column";
	blockId: string;
	column: TableColumnSchema;
	index?: number;
	viewId?: string;
}

export interface DatabaseUpdateColumnOp {
	type: "database-update-column";
	blockId: string;
	columnId: string;
	patch: Partial<Omit<TableColumnSchema, "id" | "type">>;
}

export interface DatabaseConvertColumnOp {
	type: "database-convert-column";
	blockId: string;
	columnId: string;
	toType: ColumnType;
}

export interface DatabaseRemoveColumnOp {
	type: "database-remove-column";
	blockId: string;
	columnId: string;
}

export interface DatabaseInsertRowOp {
	type: "database-insert-row";
	blockId: string;
	index?: number;
	rowId?: string;
	values?: Record<string, string>;
}

export interface DatabaseUpdateCellOp {
	type: "database-update-cell";
	blockId: string;
	rowId: string;
	columnId: string;
	value: string;
}

export interface DatabaseDeleteRowOp {
	type: "database-delete-row";
	blockId: string;
	rowId: string;
}

export interface DatabaseDeleteRowsOp {
	type: "database-delete-rows";
	blockId: string;
	rowIds: string[];
}

export interface DatabaseDuplicateRowOp {
	type: "database-duplicate-row";
	blockId: string;
	rowId: string;
	newRowId?: string;
}

export interface DatabaseMoveRowOp {
	type: "database-move-row";
	blockId: string;
	rowId: string;
	index: number;
}

export interface DatabaseAddViewOp {
	type: "database-add-view";
	blockId: string;
	view: DatabaseViewState;
	index?: number;
}

export interface DatabaseUpdateViewOp {
	type: "database-update-view";
	blockId: string;
	viewId?: string;
	patch: Partial<DatabaseViewState>;
}

export interface DatabaseRemoveViewOp {
	type: "database-remove-view";
	blockId: string;
	viewId: string;
}

export interface DatabaseSetActiveViewOp {
	type: "database-set-active-view";
	blockId: string;
	viewId: string;
}

export interface DatabaseUpdateSelectOptionsOp {
	type: "database-update-select-options";
	blockId: string;
	columnId: string;
	action: "add" | "remove" | "rename" | "recolor" | "reorder";
	optionId?: string;
	option?: SelectOption;
	value?: string;
	color?: string;
	order?: string[];
}

// ── Meta ops ────────────────────────────────────────────────

export interface SetMetaOp {
	type: "set-meta";
	blockId: string;
	namespace: string;
	data: Record<string, unknown> | null;
}

// ── App ops ─────────────────────────────────────────────────

export interface CreateAppOp {
	type: "create-app";
	appId: string;
	appType: string;
	config: Record<string, unknown>;
	placement: AppPlacement;
}
export interface UpdateAppOp {
	type: "update-app";
	appId: string;
	patch: Record<string, unknown>;
}
export interface DeleteAppOp {
	type: "delete-app";
	appId: string;
}

// ── Selection ops ───────────────────────────────────────────

export interface SetSelectionOp {
	type: "set-selection";
	selection: SelectionState;
}
