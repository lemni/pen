import type { Editor } from "@pen/types";
import type { DatabaseViewState, TableColumnSchema } from "@pen/types";
import type { DocumentMutationPlan } from "./planTypes";
import type { AITargetKind } from "./contracts";

export interface StructuralReviewItem {
	id: string;
	targetKind: AITargetKind | "bundle";
	planKind: DocumentMutationPlan["kind"];
	changeKind: "added" | "removed" | "updated" | "moved";
	section: "content" | "block" | "row" | "cell" | "schema" | "view";
	groupId: string;
	groupLabel: string;
	label: string;
	summary: string;
	detail?: string;
	preview?: string;
	before?: string;
	after?: string;
	comparisonRows?: StructuralReviewComparisonRow[];
	bundlePath: number[];
	stepIndex: number | null;
}

export interface StructuralReviewComparisonRow {
	label: string;
	before?: string;
	after?: string;
	changeKind: "added" | "removed" | "updated";
	section: "schema" | "view";
}

interface StructuralReviewBuildContext {
	virtualBlocks: Map<string, VirtualReviewBlock>;
}

interface DatabaseReviewSnapshot {
	columns: TableColumnSchema[];
	rows: Array<{
		id: string;
		values: Record<string, string>;
	}>;
	views: DatabaseViewState[];
	primaryViewId: string | null;
}

export interface StructuredPreviewDatabaseState {
	columns: TableColumnSchema[];
	rows: Array<{
		id: string;
		values: Record<string, string>;
	}>;
	views: DatabaseViewState[];
	primaryViewId: string | null;
}

export interface StructuredPreviewTargetState {
	blockId: string;
	targetKind: "database";
	database: StructuredPreviewDatabaseState;
}

type VirtualReviewBlock = {
	type: "database";
	database: DatabaseReviewSnapshot;
};

export function buildStructuralReviewItems(
	editor: Editor,
	plan: DocumentMutationPlan,
): StructuralReviewItem[] {
	return buildStructuralPreviewArtifacts(editor, plan).reviewItems;
}

export function buildStructuredPreviewTargets(
	editor: Editor,
	plan: DocumentMutationPlan,
): StructuredPreviewTargetState[] {
	return buildStructuralPreviewArtifacts(editor, plan).targets;
}

function buildStructuralPreviewArtifacts(
	editor: Editor,
	plan: DocumentMutationPlan,
): {
	reviewItems: StructuralReviewItem[];
	targets: StructuredPreviewTargetState[];
} {
	const context: StructuralReviewBuildContext = {
		virtualBlocks: new Map(),
	};
	const reviewItems = buildReviewItemsForPlan(editor, plan, [], context);
	return {
		reviewItems,
		targets: serializeStructuredPreviewTargets(context.virtualBlocks),
	};
}

export function selectStructuralReviewItemPlan(
	plan: DocumentMutationPlan,
	item: StructuralReviewItem,
): DocumentMutationPlan | null {
	return selectPlanAtPath(plan, item.bundlePath, item.stepIndex);
}

export function removeStructuralReviewItemPlan(
	plan: DocumentMutationPlan,
	item: StructuralReviewItem,
): DocumentMutationPlan | null {
	return removePlanAtPath(plan, item.bundlePath, item.stepIndex);
}

function buildReviewItemsForPlan(
	editor: Editor,
	plan: DocumentMutationPlan,
	bundlePath: number[],
	context: StructuralReviewBuildContext,
): StructuralReviewItem[] {
	switch (plan.kind) {
		case "text_edit":
			return [
				createReviewItem(bundlePath, plan.kind, "text", {
					changeKind: describeTextEditChangeKind(plan.operation),
					section: "content",
					groupId: `block:${plan.target.blockId}`,
					groupLabel: `Block "${plan.target.blockId}"`,
					label: describeTextEditLabel(plan.operation),
					summary: "Updates the selected text range.",
					preview: plan.text,
					before: readTextEditBefore(editor, plan),
					after: plan.text,
				}),
			];
		case "flow_patch":
			return plan.edits.map((edit, index) =>
				createReviewItem(bundlePath, plan.kind, "text", {
					changeKind:
						edit.operation === "append_text" || edit.operation === "insert_after" || edit.operation === "insert_before"
							? "added"
							: edit.operation === "delete_blocks"
								? "removed"
								: "updated",
					section: "content",
					groupId:
						edit.locator.blockId != null
							? `block:${edit.locator.blockId}`
							: `span:${plan.targetSpanId ?? "flow-patch"}`,
					groupLabel:
						edit.locator.blockId != null
							? `Block "${edit.locator.blockId}"`
							: `Span "${plan.targetSpanId ?? "flow-patch"}"`,
					label: `Flow patch: ${edit.operation}`,
					summary: plan.instructions,
					detail: edit.locator.expectedBlockType,
					preview: edit.text ?? edit.markdown,
					before:
						edit.locator.blockId != null
							? editor.getBlock(edit.locator.blockId)?.textContent() ?? undefined
							: undefined,
					after: edit.text ?? edit.markdown,
					stepIndex: index,
				}),
			);
		case "block_insert":
			registerInsertedReviewBlock(context, plan);
			return [
				createReviewItem(bundlePath, plan.kind, "block", {
					changeKind: "added",
					section: "block",
					groupId: "blocks",
					groupLabel: "Blocks",
					label: "Insert block",
					summary: `Adds a new ${plan.blockType} block.`,
					detail: plan.blockType,
					preview: plan.initialText,
					before: "(new block)",
					after: describeInsertedBlockAfter(plan),
				}),
			];
		case "block_update":
			return [
				createReviewItem(bundlePath, plan.kind, "block", {
					changeKind: "updated",
					section: "block",
					groupId: `block:${plan.blockId}`,
					groupLabel: `Block "${plan.blockId}"`,
					label: "Update block",
					summary: "Updates block properties.",
					detail: `${Object.keys(plan.props).length} prop changes`,
					before: readBlockPropsPreview(editor, plan.blockId),
					after: stringifyReviewValue(plan.props),
				}),
			];
		case "block_move":
			return [
				createReviewItem(bundlePath, plan.kind, "block", {
					changeKind: "moved",
					section: "block",
					groupId: `block:${plan.blockId}`,
					groupLabel: `Block "${plan.blockId}"`,
					label: "Move block",
					summary: "Moves this block to a new position.",
				}),
			];
		case "block_convert":
			return [
				createReviewItem(bundlePath, plan.kind, "block", {
					changeKind: "updated",
					section: "block",
					groupId: `block:${plan.blockId}`,
					groupLabel: `Block "${plan.blockId}"`,
					label: "Convert block",
					summary: `Converts this block to ${plan.newType}.`,
					detail: plan.newType,
					before: readBlockTypePreview(editor, plan.blockId),
					after: plan.newType,
				}),
			];
		case "database_edit":
			return buildDatabaseReviewItems(
				editor,
				plan,
				bundlePath,
				context,
			);
		case "review_bundle":
			return plan.plans.flatMap((nestedPlan, index) =>
				buildReviewItemsForPlan(editor, nestedPlan, [...bundlePath, index], context),
			);
	}
}

function serializeStructuredPreviewTargets(
	virtualBlocks: Map<string, VirtualReviewBlock>,
): StructuredPreviewTargetState[] {
	return [...virtualBlocks.entries()].map(([blockId, virtualBlock]) => {
		return {
			blockId,
			targetKind: "database",
			database: cloneDatabaseReviewSnapshot(virtualBlock.database),
		};
	});
}

function buildDatabaseReviewItems(
	editor: Editor,
	plan: Extract<DocumentMutationPlan, { kind: "database_edit" }>,
	bundlePath: number[],
	context: StructuralReviewBuildContext,
): StructuralReviewItem[] {
	const snapshot = getDatabaseReviewSnapshot(editor, plan.blockId, context);
	const items: StructuralReviewItem[] = [];

	for (let index = 0; index < plan.steps.length; index += 1) {
		const step = plan.steps[index]!;
		const beforeSnapshot = snapshot ? cloneDatabaseReviewSnapshot(snapshot) : null;
		items.push(
			createReviewItem(bundlePath, plan.kind, "database", {
				changeKind: describeDatabaseStepChangeKind(step.op),
				section: describeDatabaseStepSection(step.op),
				groupId: `database:${plan.blockId}`,
				groupLabel: `Database "${plan.blockId}"`,
				label: describeDatabaseStepLabel(step.op),
				summary: describeDatabaseStepSummary(plan.blockId, step),
				detail: describeDatabaseStepDetail(beforeSnapshot, step),
				preview: describeDatabaseStepPreview(step),
				before: describeDatabaseStepBefore(beforeSnapshot, step),
				after: describeDatabaseStepAfter(beforeSnapshot, step),
				comparisonRows: describeDatabaseStepComparisonRows(beforeSnapshot, step),
				stepIndex: index,
			}),
		);
		if (snapshot) {
			applyDatabaseStepToReviewSnapshot(snapshot, step);
		}
	}

	if (snapshot) {
		context.virtualBlocks.set(plan.blockId, {
			type: "database",
			database: cloneDatabaseReviewSnapshot(snapshot),
		});
	}

	return items;
}

function createReviewItem(
	bundlePath: number[],
	planKind: DocumentMutationPlan["kind"],
	targetKind: StructuralReviewItem["targetKind"],
	input: {
		changeKind: StructuralReviewItem["changeKind"];
		section: StructuralReviewItem["section"];
		groupId: string;
		groupLabel: string;
		label: string;
		summary: string;
		detail?: string;
		preview?: string;
		before?: string;
		after?: string;
		comparisonRows?: StructuralReviewComparisonRow[];
		stepIndex?: number;
	},
): StructuralReviewItem {
	const stepIndex = input.stepIndex ?? null;
	return {
		id: createReviewItemId(planKind, bundlePath, stepIndex),
		targetKind,
		planKind,
		changeKind: input.changeKind,
		section: input.section,
		groupId: input.groupId,
		groupLabel: input.groupLabel,
		label: input.label,
		summary: input.summary,
		detail: input.detail,
		preview: input.preview,
		before: input.before,
		after: input.after,
		comparisonRows: input.comparisonRows,
		bundlePath,
		stepIndex,
	};
}

function createReviewItemId(
	planKind: DocumentMutationPlan["kind"],
	bundlePath: number[],
	stepIndex: number | null,
): string {
	const pathPart = bundlePath.length > 0 ? bundlePath.join(".") : "root";
	const stepPart = stepIndex == null ? "plan" : `step-${stepIndex}`;
	return `plan:${planKind}:${pathPart}:${stepPart}`;
}

function selectPlanAtPath(
	plan: DocumentMutationPlan,
	bundlePath: number[],
	stepIndex: number | null,
): DocumentMutationPlan | null {
	if (bundlePath.length > 0) {
		if (plan.kind !== "review_bundle") {
			return null;
		}
		const [head, ...tail] = bundlePath;
		const nestedPlan = plan.plans[head];
		if (!nestedPlan) {
			return null;
		}
		return selectPlanAtPath(nestedPlan, tail, stepIndex);
	}

	if (stepIndex == null) {
		return plan;
	}

	if (plan.kind === "database_edit") {
		const step = plan.steps[stepIndex];
		return step ? { ...plan, steps: [step] } : null;
	}
	if (plan.kind === "flow_patch") {
		const edit = plan.edits[stepIndex];
		return edit ? { ...plan, edits: [edit] } : null;
	}

	return null;
}

function removePlanAtPath(
	plan: DocumentMutationPlan,
	bundlePath: number[],
	stepIndex: number | null,
): DocumentMutationPlan | null {
	if (bundlePath.length > 0) {
		if (plan.kind !== "review_bundle") {
			return null;
		}
		const [head, ...tail] = bundlePath;
		const nestedPlan = plan.plans[head];
		if (!nestedPlan) {
			return plan;
		}
		const nextNestedPlan = removePlanAtPath(nestedPlan, tail, stepIndex);
		const nextPlans = plan.plans.flatMap((entry, index) => {
			if (index !== head) {
				return [entry];
			}
			return nextNestedPlan ? [nextNestedPlan] : [];
		});
		if (nextPlans.length === 0) {
			return null;
		}
		if (nextPlans.length === 1) {
			return nextPlans[0] ?? null;
		}
		return { ...plan, plans: nextPlans };
	}

	if (stepIndex == null) {
		return null;
	}

	if (plan.kind === "database_edit") {
		const nextSteps = plan.steps.filter((_, index) => index !== stepIndex);
		return nextSteps.length > 0 ? { ...plan, steps: nextSteps } : null;
	}
	if (plan.kind === "flow_patch") {
		const nextEdits = plan.edits.filter((_, index) => index !== stepIndex);
		return nextEdits.length > 0 ? { ...plan, edits: nextEdits } : null;
	}

	return null;
}

function describeTextEditLabel(
	operation: "replace" | "insert" | "append",
): string {
	if (operation === "replace") {
		return "Replace text";
	}
	if (operation === "insert") {
		return "Insert text";
	}
	return "Append text";
}

function describeTextEditChangeKind(
	operation: "replace" | "insert" | "append",
): StructuralReviewItem["changeKind"] {
	return operation === "replace" ? "updated" : "added";
}

function describeDatabaseStepLabel(step: string): string {
	switch (step) {
		case "add_column":
			return "Add column";
		case "update_column":
			return "Update column";
		case "insert_row":
			return "Insert row";
		case "update_cell":
			return "Update cell";
		case "add_view":
			return "Add view";
		case "set_active_view":
			return "Set active view";
		default:
			return "Database change";
	}
}

function describeDatabaseStepChangeKind(
	step: string,
): StructuralReviewItem["changeKind"] {
	switch (step) {
		case "add_column":
		case "insert_row":
		case "add_view":
			return "added";
		case "update_column":
		case "update_cell":
		case "set_active_view":
		default:
			return "updated";
	}
}

function describeDatabaseStepSection(
	step: string,
): StructuralReviewItem["section"] {
	switch (step) {
		case "add_column":
		case "update_column":
			return "schema";
		case "insert_row":
			return "row";
		case "update_cell":
			return "cell";
		case "add_view":
		case "set_active_view":
		default:
			return "view";
	}
}

function describeDatabaseStepSummary(
	blockId: string,
	step: Extract<
		DocumentMutationPlan,
		{ kind: "database_edit" }
	>["steps"][number],
): string {
	switch (step.op) {
		case "add_column":
			return `Adds a column to database "${blockId}".`;
		case "update_column":
			return `Updates a column in database "${blockId}".`;
		case "insert_row":
			return `Adds a row to database "${blockId}".`;
		case "update_cell":
			return `Updates a database cell in "${blockId}".`;
		case "add_view":
			return `Adds a view to database "${blockId}".`;
		case "set_active_view":
			return `Changes the active view for database "${blockId}".`;
	}
}

function describeDatabaseStepDetail(
	snapshot: DatabaseReviewSnapshot | null,
	step: Extract<
		DocumentMutationPlan,
		{ kind: "database_edit" }
	>["steps"][number],
): string | undefined {
	switch (step.op) {
		case "add_column":
			return resolveColumnLabel(step.column);
		case "update_column":
			return resolveDatabaseColumnLabel(snapshot?.columns ?? [], step.columnId);
		case "insert_row":
			return formatDatabaseValueKeys(snapshot?.columns ?? [], step.values);
		case "update_cell":
			return `${resolveDatabaseRowLabel(snapshot, step.rowId)} · ${resolveDatabaseColumnLabel(snapshot?.columns ?? [], step.columnId)}`;
		case "add_view":
			return resolveViewLabel(step.view);
		case "set_active_view":
			return (
				snapshot?.views.find((view) => view.id === step.viewId)?.title ??
				snapshot?.views.find((view) => view.id === step.viewId)?.id ??
				step.viewId
			);
	}
}

function describeDatabaseStepPreview(
	step: Extract<
		DocumentMutationPlan,
		{ kind: "database_edit" }
	>["steps"][number],
): string | undefined {
	switch (step.op) {
		case "update_cell":
			return stringifyReviewValue(step.value);
		case "insert_row":
			return stringifyReviewValue(step.values);
		default:
			return undefined;
	}
}

function describeDatabaseStepBefore(
	snapshot: DatabaseReviewSnapshot | null,
	step: Extract<
		DocumentMutationPlan,
		{ kind: "database_edit" }
	>["steps"][number],
): string | undefined {
	switch (step.op) {
		case "add_column":
			return summarizeColumns(snapshot?.columns ?? []);
		case "update_column":
			return formatColumnSchema(
				snapshot?.columns.find((column) => column.id === step.columnId),
			);
		case "insert_row":
			return snapshot ? `${snapshot.rows.length} rows` : undefined;
		case "update_cell": {
			if (!snapshot) {
				return undefined;
			}
			const rowIndex = findDatabaseReviewRowIndex(snapshot, step.rowId);
			const colIndex = findColumnIndex(snapshot.columns, step.columnId);
			if (rowIndex === -1 || colIndex === -1) {
				return undefined;
			}
			const columnId = snapshot.columns[colIndex]?.id;
			return columnId ? snapshot.rows[rowIndex]?.values[columnId] ?? "" : undefined;
		}
		case "add_view":
			return summarizeViews(snapshot?.views ?? []);
		case "set_active_view":
			return snapshot ? resolveViewLabel(resolveDatabaseActiveViewSnapshot(snapshot)) : undefined;
	}
}

function describeDatabaseStepAfter(
	snapshot: DatabaseReviewSnapshot | null,
	step: Extract<
		DocumentMutationPlan,
		{ kind: "database_edit" }
	>["steps"][number],
): string | undefined {
	switch (step.op) {
		case "add_column":
			return formatColumnSchema(step.column);
		case "update_column": {
			const column = snapshot?.columns.find((entry) => entry.id === step.columnId);
			return formatColumnSchema(column ? { ...column, ...step.patch } : undefined);
		}
		case "insert_row":
			return snapshot ? `${snapshot.rows.length + 1} rows` : undefined;
		case "update_cell":
			return stringifyReviewValue(step.value);
		case "add_view":
			return formatViewState(step.view, snapshot?.columns ?? []);
		case "set_active_view": {
			const nextView = snapshot?.views.find((view) => view.id === step.viewId);
			return resolveViewLabel(nextView) ?? step.viewId;
		}
	}
}

function describeDatabaseStepComparisonRows(
	snapshot: DatabaseReviewSnapshot | null,
	step: Extract<
		DocumentMutationPlan,
		{ kind: "database_edit" }
	>["steps"][number],
): StructuralReviewComparisonRow[] | undefined {
	switch (step.op) {
		case "add_column":
			return [
				{
					label: "Column",
					before: undefined,
					after: formatColumnSchema(step.column),
					changeKind: "added",
					section: "schema",
				},
			];
		case "update_column": {
			const column = snapshot?.columns.find((entry) => entry.id === step.columnId);
			const nextColumn = column ? { ...column, ...step.patch } : undefined;
			if (!column && !nextColumn) {
				return undefined;
			}
			return buildColumnSchemaComparisonRows(column, nextColumn);
		}
		case "add_view":
			return buildViewComparisonRows(undefined, step.view, snapshot?.columns ?? []);
		case "set_active_view":
			return buildViewComparisonRows(
				resolveDatabaseActiveViewSnapshot(snapshot) ?? undefined,
				snapshot?.views.find((view) => view.id === step.viewId),
				snapshot?.columns ?? [],
			);
		default:
			return undefined;
	}
}

function stringifyReviewValue(value: unknown): string | undefined {
	if (value == null) {
		return undefined;
	}
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function readTextEditBefore(
	editor: Editor,
	plan: Extract<DocumentMutationPlan, { kind: "text_edit" }>,
): string | undefined {
	const block = editor.getBlock(plan.target.blockId);
	if (!block) {
		return undefined;
	}
	const text = block.textContent();
	if (plan.target.range) {
		return text.slice(
			plan.target.range.startOffset,
			plan.target.range.endOffset,
		);
	}
	return text;
}

function readBlockPropsPreview(editor: Editor, blockId: string): string | undefined {
	const block = editor.getBlock(blockId);
	return block ? stringifyReviewValue(block.props) : undefined;
}

function readBlockTypePreview(editor: Editor, blockId: string): string | undefined {
	const block = editor.getBlock(blockId);
	return block?.type;
}

function registerInsertedReviewBlock(
	context: StructuralReviewBuildContext,
	plan: Extract<DocumentMutationPlan, { kind: "block_insert" }>,
): void {
	if (!plan.blockId) {
		return;
	}
	if (plan.blockType === "database") {
		context.virtualBlocks.set(plan.blockId, {
			type: "database",
			database: createDefaultDatabaseReviewSnapshot(),
		});
	}
}

function describeInsertedBlockAfter(
	plan: Extract<DocumentMutationPlan, { kind: "block_insert" }>,
): string | undefined {
	if (plan.initialText) {
		return plan.initialText;
	}
	if (plan.blockType === "database") {
		return "3 columns, 0 rows, 1 view";
	}
	return plan.blockType;
}

function getDatabaseReviewSnapshot(
	editor: Editor,
	blockId: string,
	context: StructuralReviewBuildContext,
): DatabaseReviewSnapshot | null {
	const virtualBlock = context.virtualBlocks.get(blockId);
	if (virtualBlock?.type === "database") {
		return cloneDatabaseReviewSnapshot(virtualBlock.database);
	}
	const block = editor.getBlock(blockId);
	if (!block || block.type !== "database") {
		return null;
	}
	const columns = [...block.tableColumns()];
	const rows = Array.from({ length: block.tableRowCount() }, (_, rowIndex) => {
		const rowId = block.tableRow(rowIndex)?.id ?? `row-${rowIndex + 1}`;
		return {
			id: rowId,
			values: Object.fromEntries(
				columns.map((column, colIndex) => [
					column.id,
					block.tableCell(rowIndex, colIndex)?.textContent() ?? "",
				]),
			),
		};
	});
	return {
		columns,
		rows,
		views: [...block.databaseViews()],
		primaryViewId: block.databasePrimaryViewId(),
	};
}

function cloneDatabaseReviewSnapshot(
	snapshot: DatabaseReviewSnapshot,
): DatabaseReviewSnapshot {
	return {
		columns: snapshot.columns.map((column) => ({ ...column })),
		rows: snapshot.rows.map((row) => ({
			id: row.id,
			values: { ...row.values },
		})),
		views: snapshot.views.map((view) => ({
			...view,
			visibleColumnIds: view.visibleColumnIds ? [...view.visibleColumnIds] : undefined,
			columnOrder: view.columnOrder ? [...view.columnOrder] : undefined,
			sort: view.sort ? [...view.sort] : undefined,
			rowPinning: view.rowPinning ? { ...view.rowPinning } : undefined,
		})),
		primaryViewId: snapshot.primaryViewId,
	};
}

function createDefaultDatabaseReviewSnapshot(): DatabaseReviewSnapshot {
	const columns: TableColumnSchema[] = [
		{ id: "name", title: "Name", type: "text" },
		{ id: "tags", title: "Tags", type: "select" },
		{ id: "done", title: "Done", type: "checkbox" },
	];
	const primaryViewId = "view-table";
	return {
		columns,
		rows: [],
		views: [
			{
				id: primaryViewId,
				title: "Table",
				type: "table",
				visibleColumnIds: columns.map((column) => column.id),
				columnOrder: columns.map((column) => column.id),
			},
		],
		primaryViewId,
	};
}

function applyDatabaseStepToReviewSnapshot(
	snapshot: DatabaseReviewSnapshot,
	step: Extract<DocumentMutationPlan, { kind: "database_edit" }>["steps"][number],
): void {
	switch (step.op) {
		case "add_column":
			snapshot.columns.push({ ...step.column });
			for (const row of snapshot.rows) {
				row.values[step.column.id] = "";
			}
			return;
		case "update_column": {
			const columnIndex = snapshot.columns.findIndex(
				(column) => column.id === step.columnId,
			);
			if (columnIndex !== -1) {
				snapshot.columns[columnIndex] = {
					...snapshot.columns[columnIndex]!,
					...step.patch,
				};
			}
			return;
		}
		case "insert_row":
			snapshot.rows.push({
				id: step.rowId ?? `row-${snapshot.rows.length + 1}`,
				values: stringifyRecord(step.values),
			});
			return;
		case "update_cell": {
			const row = snapshot.rows.find((entry) => entry.id === step.rowId);
			if (row) {
				row.values[step.columnId] = stringifyDatabaseValue(step.value);
			}
			return;
		}
		case "add_view":
			snapshot.views.push({
				...step.view,
				visibleColumnIds: step.view.visibleColumnIds
					? [...step.view.visibleColumnIds]
					: undefined,
				columnOrder: step.view.columnOrder ? [...step.view.columnOrder] : undefined,
				sort: step.view.sort ? [...step.view.sort] : undefined,
				rowPinning: step.view.rowPinning ? { ...step.view.rowPinning } : undefined,
			});
			return;
		case "set_active_view":
			snapshot.primaryViewId = step.viewId;
			return;
	}
}

function summarizeColumns(columns: readonly TableColumnSchema[]): string | undefined {
	if (columns.length === 0) {
		return undefined;
	}
	return columns.map(formatColumnSchema).filter(Boolean).join(", ");
}

function summarizeViews(views: readonly DatabaseViewState[]): string | undefined {
	if (views.length === 0) {
		return undefined;
	}
	return views.map((view) => resolveViewLabel(view)).filter(Boolean).join(", ");
}

function findDatabaseReviewRowIndex(
	snapshot: DatabaseReviewSnapshot,
	rowId: string,
): number {
	for (let index = 0; index < snapshot.rows.length; index += 1) {
		if (snapshot.rows[index]?.id === rowId) {
			return index;
		}
	}
	return -1;
}

function findColumnIndex(
	columns: readonly TableColumnSchema[],
	columnId: string,
): number {
	return columns.findIndex((column) => column.id === columnId);
}

function resolveColumnLabel(column: TableColumnSchema | undefined): string {
	return column?.title || column?.id || "Column";
}

function resolveDatabaseColumnLabel(
	columns: readonly TableColumnSchema[],
	columnId: string,
): string {
	const column = columns.find((entry) => entry.id === columnId);
	return column ? resolveColumnLabel(column) : columnId;
}

function resolveDatabaseRowLabel(
	snapshot: DatabaseReviewSnapshot | null,
	rowId: string,
): string {
	if (!snapshot) {
		return rowId;
	}
	const rowIndex = findDatabaseReviewRowIndex(snapshot, rowId);
	if (rowIndex === -1) {
		return rowId;
	}

	const columns = snapshot.columns;
	const preferredColumnIds = [
		columns.find((column) => column.title.toLowerCase() === "name")?.id,
		columns[0]?.id,
	].filter(Boolean) as string[];

	for (const columnId of preferredColumnIds) {
		const value = snapshot.rows[rowIndex]?.values[columnId]?.trim();
		if (value) {
			return value;
		}
	}

	return `Row ${rowIndex + 1}`;
}

function resolveDatabaseActiveViewSnapshot(
	snapshot: DatabaseReviewSnapshot | null,
): DatabaseViewState | null {
	if (!snapshot) {
		return null;
	}
	if (!snapshot.primaryViewId) {
		return snapshot.views[0] ?? null;
	}
	return (
		snapshot.views.find((view) => view.id === snapshot.primaryViewId) ??
		snapshot.views[0] ??
		null
	);
}

function resolveViewLabel(view: DatabaseViewState | null | undefined): string | undefined {
	if (!view) {
		return undefined;
	}
	return view.title ?? view.id;
}

function formatColumnSchema(
	column: TableColumnSchema | undefined,
): string | undefined {
	if (!column) {
		return undefined;
	}

	const parts = [`${resolveColumnLabel(column)} [${column.type}]`];
	if (column.width != null) {
		parts.push(`w:${column.width}`);
	}
	if (column.hidden) {
		parts.push("hidden");
	}
	if (column.pinned) {
		parts.push(`pinned:${column.pinned}`);
	}
	return parts.join(" ");
}

function formatViewState(
	view: DatabaseViewState | undefined,
	columns: readonly TableColumnSchema[],
): string | undefined {
	if (!view) {
		return undefined;
	}

	const parts = [`${resolveViewLabel(view)} [${view.type}]`];
	if (view.groupBy) {
		parts.push(`group:${resolveDatabaseColumnLabel(columns, view.groupBy)}`);
	}
	if (view.visibleColumnIds && view.visibleColumnIds.length > 0) {
		parts.push(
			`visible:${view.visibleColumnIds
				.map((columnId) => resolveDatabaseColumnLabel(columns, columnId))
				.join(", ")}`,
		);
	}
	return parts.join(" ");
}

function formatDatabaseValueKeys(
	columns: readonly TableColumnSchema[],
	values: Record<string, unknown>,
): string | undefined {
	const keys = Object.keys(values);
	if (keys.length === 0) {
		return undefined;
	}
	return keys
		.map((key) => resolveDatabaseColumnLabel(columns, key))
		.join(", ");
}

function stringifyRecord(
	value: Record<string, unknown>,
): Record<string, string> {
	return Object.fromEntries(
		Object.entries(value).map(([key, entryValue]) => [
			key,
			stringifyDatabaseValue(entryValue),
		]),
	);
}

function stringifyDatabaseValue(value: unknown): string {
	if (value == null) {
		return "";
	}
	if (typeof value === "string") {
		return value;
	}
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		typeof value === "bigint"
	) {
		return String(value);
	}
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function buildColumnComparisonRows(
	beforeColumns: readonly TableColumnSchema[],
	afterColumns: readonly TableColumnSchema[],
): StructuralReviewComparisonRow[] | undefined {
	const rows: StructuralReviewComparisonRow[] = [];
	const beforeOrder = beforeColumns.map((column) => resolveColumnLabel(column)).join(", ");
	const afterOrder = afterColumns.map((column) => resolveColumnLabel(column)).join(", ");
	if (beforeOrder !== afterOrder) {
		rows.push({
			label: "Order",
			before: beforeOrder || undefined,
			after: afterOrder || undefined,
			changeKind: "updated",
			section: "schema",
		});
	}

	const beforeById = new Map(beforeColumns.map((column) => [column.id, column]));
	const afterById = new Map(afterColumns.map((column) => [column.id, column]));
	const allIds = [...new Set([...beforeById.keys(), ...afterById.keys()])];

	for (const id of allIds) {
		const beforeColumn = beforeById.get(id);
		const afterColumn = afterById.get(id);
		if (!beforeColumn && afterColumn) {
			rows.push({
				label: `Added ${resolveColumnLabel(afterColumn)}`,
				after: formatColumnSchema(afterColumn),
				changeKind: "added",
				section: "schema",
			});
			continue;
		}
		if (beforeColumn && !afterColumn) {
			rows.push({
				label: `Removed ${resolveColumnLabel(beforeColumn)}`,
				before: formatColumnSchema(beforeColumn),
				changeKind: "removed",
				section: "schema",
			});
			continue;
		}
		if (!beforeColumn || !afterColumn) {
			continue;
		}
		if (!areColumnSchemasEqual(beforeColumn, afterColumn)) {
			rows.push({
				label: resolveColumnLabel(afterColumn),
				before: formatColumnSchema(beforeColumn),
				after: formatColumnSchema(afterColumn),
				changeKind: "updated",
				section: "schema",
			});
		}
	}

	return rows.length > 0 ? rows : undefined;
}

function buildColumnSchemaComparisonRows(
	beforeColumn: TableColumnSchema | undefined,
	afterColumn: TableColumnSchema | undefined,
): StructuralReviewComparisonRow[] | undefined {
	if (!beforeColumn && !afterColumn) {
		return undefined;
	}

	const rows: StructuralReviewComparisonRow[] = [];
	const label = resolveColumnLabel(afterColumn ?? beforeColumn);
	rows.push({
		label,
		before: formatColumnSchema(beforeColumn),
		after: formatColumnSchema(afterColumn),
		changeKind:
			beforeColumn == null ? "added" : afterColumn == null ? "removed" : "updated",
		section: "schema",
	});

	return rows;
}

function buildViewComparisonRows(
	beforeView: DatabaseViewState | undefined,
	afterView: DatabaseViewState | undefined,
	columns: readonly TableColumnSchema[],
): StructuralReviewComparisonRow[] | undefined {
	if (!beforeView && !afterView) {
		return undefined;
	}

	const rows: StructuralReviewComparisonRow[] = [
		{
			label: "View",
			before: resolveViewLabel(beforeView),
			after: resolveViewLabel(afterView),
			changeKind:
				beforeView == null ? "added" : afterView == null ? "removed" : "updated",
			section: "view",
		},
		{
			label: "Type",
			before: beforeView?.type,
			after: afterView?.type,
			changeKind: "updated",
			section: "view",
		},
		{
			label: "Group by",
			before: beforeView?.groupBy
				? resolveDatabaseColumnLabel(columns, beforeView.groupBy)
				: undefined,
			after: afterView?.groupBy
				? resolveDatabaseColumnLabel(columns, afterView.groupBy)
				: undefined,
			changeKind: "updated",
			section: "view",
		},
		{
			label: "Visible columns",
			before: beforeView?.visibleColumnIds?.length
				? beforeView.visibleColumnIds
						.map((columnId) => resolveDatabaseColumnLabel(columns, columnId))
						.join(", ")
				: undefined,
			after: afterView?.visibleColumnIds?.length
				? afterView.visibleColumnIds
						.map((columnId) => resolveDatabaseColumnLabel(columns, columnId))
						.join(", ")
				: undefined,
			changeKind: "updated",
			section: "view",
		},
		{
			label: "Sort",
			before: formatViewSort(beforeView, columns),
			after: formatViewSort(afterView, columns),
			changeKind: "updated",
			section: "view",
		},
	];

	const meaningfulRows = rows.filter((row) => row.before !== row.after);
	return meaningfulRows.length > 0 ? meaningfulRows : undefined;
}

function areColumnSchemasEqual(
	left: TableColumnSchema,
	right: TableColumnSchema,
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function formatViewSort(
	view: DatabaseViewState | undefined,
	columns: readonly TableColumnSchema[],
): string | undefined {
	if (!view?.sort || view.sort.length === 0) {
		return undefined;
	}
	return view.sort
		.map(
			(sortEntry) =>
				`${resolveDatabaseColumnLabel(columns, sortEntry.columnId)} ${sortEntry.direction}`,
		)
		.join(", ");
}
