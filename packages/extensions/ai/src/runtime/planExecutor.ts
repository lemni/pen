import type { DocumentOp, Editor } from "@pen/types";
import { buildDocumentWriteOps } from "@pen/document-ops";
import { generateId } from "@pen/types";
import type {
	BlockConvertPlan,
	BlockInsertPlan,
	BlockMovePlan,
	BlockUpdatePlan,
	DatabaseEditPlan,
	DocumentMutationPlan,
	FlowPatchEdit,
	FlowPatchPlan,
	ReviewBundlePlan,
	TextEditPlan,
} from "./planTypes";

export interface PlanExecutionIssue {
	path: string;
	code:
	| "missing-block"
	| "invalid-target"
	| "unsupported-target"
	| "invalid-range";
	message: string;
}

export interface PlanExecutionResult {
	ops: DocumentOp[];
	issues: PlanExecutionIssue[];
	reviewSafe: boolean;
	metrics?: PlanExecutionMetrics;
}

export interface PlanExecutionMetrics {
	flowPatchAlignment?: FlowPatchAlignmentMetrics;
}

export interface FlowPatchAlignmentMetrics {
	preservedBlockCount: number;
	rewrittenBlockCount: number;
	unchangedBlockCount: number;
	insertedBlockCount: number;
	deletedBlockCount: number;
	estimatedOperationCost: number;
}

interface VirtualBlockState {
	type: string;
	props: Record<string, unknown>;
	textLength: number;
	database?: {
		columnIds: Set<string>;
		rowIds: Set<string>;
		viewIds: Set<string>;
	};
}

interface PlanExecutionContext {
	virtualBlocks: Map<string, VirtualBlockState>;
}

interface PendingInlineMark {
	type: string;
	props?: Record<string, unknown>;
	start: number;
	end: number;
}

interface PendingInlineBlock {
	type: string;
	props: Record<string, unknown>;
	content?: string;
	marks?: PendingInlineMark[];
	children?: unknown[];
	database?: unknown;
}

interface InlineAlignmentStep {
	kind: "substitute" | "insert" | "delete";
	targetIndex?: number;
	parsedIndex?: number;
}

interface InlineAlignmentResolution {
	steps: InlineAlignmentStep[];
	metrics: FlowPatchAlignmentMetrics;
}

export function buildDocumentMutationPlanExecution(
	editor: Editor,
	plan: DocumentMutationPlan,
): PlanExecutionResult {
	const context: PlanExecutionContext = {
		virtualBlocks: new Map(),
	};
	return buildPlanExecution(editor, plan, context);
}

function buildPlanExecution(
	editor: Editor,
	plan: DocumentMutationPlan,
	context: PlanExecutionContext,
): PlanExecutionResult {
	switch (plan.kind) {
		case "text_edit":
			return buildTextEditExecution(editor, plan, context);
		case "flow_patch":
			return buildFlowPatchExecution(editor, plan);
		case "block_insert":
			return buildBlockInsertExecution(editor, plan, context);
		case "block_update":
			return buildBlockUpdateExecution(editor, plan, context);
		case "block_move":
			return buildBlockMoveExecution(editor, plan, context);
		case "block_convert":
			return buildBlockConvertExecution(editor, plan, context);
		case "database_edit":
			return buildDatabaseEditExecution(editor, plan, context);
		case "review_bundle":
			return buildReviewBundleExecution(editor, plan, context);
	}
}

function buildTextEditExecution(
	editor: Editor,
	plan: TextEditPlan,
	context: PlanExecutionContext,
): PlanExecutionResult {
	const blockState = resolveBlockState(editor, context, plan.target.blockId);
	if (!blockState) {
		return withIssue(
			`${plan.kind}.target.blockId`,
			"missing-block",
			`Block "${plan.target.blockId}" was not found.`,
		);
	}

	const blockLength = blockState.textLength;
	if (
		plan.target.range &&
		(plan.target.range.startOffset < 0 ||
			plan.target.range.endOffset < plan.target.range.startOffset ||
			plan.target.range.endOffset > blockLength)
	) {
		return withIssue(
			`${plan.kind}.target.range`,
			"invalid-range",
			"Text edit range is outside the target block.",
		);
	}

	if (plan.operation === "append") {
		context.virtualBlocks.set(plan.target.blockId, {
			...blockState,
			textLength: blockLength + plan.text.length,
		});
		return {
			ops: [{
				type: "insert-text",
				blockId: plan.target.blockId,
				offset: blockLength,
				text: plan.text,
			}],
			issues: [],
			reviewSafe: true,
		};
	}

	if (plan.operation === "insert") {
		const offset = plan.target.range?.startOffset ?? blockLength;
		context.virtualBlocks.set(plan.target.blockId, {
			...blockState,
			textLength: blockLength + plan.text.length,
		});
		return {
			ops: [{
				type: "insert-text",
				blockId: plan.target.blockId,
				offset,
				text: plan.text,
			}],
			issues: [],
			reviewSafe: true,
		};
	}

	const offset = plan.target.range?.startOffset ?? 0;
	const length =
		plan.target.range != null
			? plan.target.range.endOffset - plan.target.range.startOffset
			: blockLength;
	context.virtualBlocks.set(plan.target.blockId, {
		...blockState,
		textLength: blockLength - length + plan.text.length,
	});

	return {
		ops: [{
			type: "replace-text",
			blockId: plan.target.blockId,
			offset,
			length,
			text: plan.text,
		}],
		issues: [],
		reviewSafe: true,
	};
}

function buildFlowPatchExecution(
	editor: Editor,
	plan: FlowPatchPlan,
): PlanExecutionResult {
	const ops: DocumentOp[] = [];
	const issues: PlanExecutionIssue[] = [];
	let reviewSafe = true;
	let flowPatchAlignmentMetrics: FlowPatchAlignmentMetrics | undefined;

	for (const [index, edit] of plan.edits.entries()) {
		const execution = buildFlowPatchEditExecution(editor, edit, `${plan.kind}.edits[${index}]`);
		ops.push(...execution.ops);
		issues.push(...execution.issues);
		reviewSafe = reviewSafe && execution.reviewSafe;
		flowPatchAlignmentMetrics = mergeFlowPatchAlignmentMetrics(
			flowPatchAlignmentMetrics,
			execution.metrics?.flowPatchAlignment,
		);
	}

	return {
		ops,
		issues,
		reviewSafe,
		metrics:
			flowPatchAlignmentMetrics == null
				? undefined
				: { flowPatchAlignment: flowPatchAlignmentMetrics },
	};
}

function buildBlockInsertExecution(
	editor: Editor,
	plan: BlockInsertPlan,
	context: PlanExecutionContext,
): PlanExecutionResult {
	const blockId = plan.blockId ?? generateId();
	if (resolveBlockState(editor, context, blockId)) {
		return withIssue(
			`${plan.kind}.blockId`,
			"invalid-target",
			`Block "${blockId}" already exists.`,
		);
	}

	context.virtualBlocks.set(
		blockId,
		createVirtualBlockState(
			plan.blockType,
			plan.props ?? {},
			plan.initialText ?? "",
		),
	);
	const ops: DocumentOp[] = [{
		type: "insert-block",
		blockId,
		blockType: plan.blockType,
		props: plan.props ?? {},
		position: plan.position,
	}];

	if (plan.initialText && plan.initialText.length > 0) {
		ops.push({
			type: "insert-text",
			blockId,
			offset: 0,
			text: plan.initialText,
		});
	}

	return {
		ops,
		issues: [],
		reviewSafe: true,
	};
}

function buildFlowPatchEditExecution(
	editor: Editor,
	edit: FlowPatchEdit,
	path: string,
): PlanExecutionResult {
	const targetBlockIds =
		edit.locator.blockIds?.filter((blockId) => blockId.length > 0) ??
		(edit.locator.blockId ? [edit.locator.blockId] : []);
	const primaryBlockId = targetBlockIds[0] ?? null;
	const primaryBlock = primaryBlockId ? editor.getBlock(primaryBlockId) : null;

	if (
		edit.locator.expectedBlockType &&
		primaryBlock &&
		primaryBlock.type !== edit.locator.expectedBlockType
	) {
		return withIssue(
			`${path}.locator.expectedBlockType`,
			"unsupported-target",
			`Block "${primaryBlock.id}" is "${primaryBlock.type}", expected "${edit.locator.expectedBlockType}".`,
		);
	}

	switch (edit.operation) {
		case "replace_text": {
			if (!primaryBlockId || !primaryBlock) {
				return withIssue(
					`${path}.locator.blockId`,
					"missing-block",
					"Flow patch replace_text requires an existing target block.",
				);
			}
			return {
				ops: [{
					type: "replace-text",
					blockId: primaryBlockId,
					offset: 0,
					length: primaryBlock.length(),
					text: edit.text ?? "",
				}],
				issues: [],
				reviewSafe: true,
			};
		}
		case "append_text": {
			if (!primaryBlockId || !primaryBlock) {
				return withIssue(
					`${path}.locator.blockId`,
					"missing-block",
					"Flow patch append_text requires an existing target block.",
				);
			}
			return {
				ops: [{
					type: "insert-text",
					blockId: primaryBlockId,
					offset: primaryBlock.length(),
					text: edit.text ?? "",
				}],
				issues: [],
				reviewSafe: true,
			};
		}
		case "insert_before":
		case "insert_after": {
			if (!primaryBlockId || !primaryBlock) {
				return withIssue(
					`${path}.locator.blockId`,
					"missing-block",
					`Flow patch ${edit.operation} requires an existing target block.`,
				);
			}
			const { ops } = buildDocumentWriteOps(editor, {
				format: "markdown",
				content: edit.markdown ?? "",
				position:
					edit.operation === "insert_before"
						? { before: primaryBlockId }
						: { after: primaryBlockId },
				surface: "ai-flow-patch",
			});
			return {
				ops,
				issues: [],
				reviewSafe: true,
			};
		}
		case "replace_blocks": {
			if (targetBlockIds.length === 0) {
				return withIssue(
					`${path}.locator.blockIds`,
					"missing-block",
					"Flow patch replace_blocks requires one or more target blocks.",
				);
			}
			if (targetBlockIds.some((blockId) => !editor.getBlock(blockId))) {
				return withIssue(
					`${path}.locator.blockIds`,
					"missing-block",
					"Flow patch replace_blocks targets a missing block.",
				);
			}
			const optimized = buildOptimizedBlockReplacement(
				editor,
				targetBlockIds,
				edit.markdown ?? "",
			);
			if (optimized) {
				return optimized;
			}
			const { ops } = buildDocumentWriteOps(editor, {
				format: "markdown",
				content: edit.markdown ?? "",
				position: { before: targetBlockIds[0]! },
				surface: "ai-flow-patch",
			});
			return {
				ops: [
					...ops,
					...targetBlockIds.map((blockId) => ({
						type: "delete-block",
						blockId,
					}) satisfies DocumentOp),
				],
				issues: [],
				reviewSafe: true,
			};
		}
		case "delete_blocks": {
			if (targetBlockIds.length === 0) {
				return withIssue(
					`${path}.locator.blockIds`,
					"missing-block",
					"Flow patch delete_blocks requires one or more target blocks.",
				);
			}
			if (targetBlockIds.some((blockId) => !editor.getBlock(blockId))) {
				return withIssue(
					`${path}.locator.blockIds`,
					"missing-block",
					"Flow patch delete_blocks targets a missing block.",
				);
			}
			return {
				ops: targetBlockIds.map((blockId) => ({
					type: "delete-block",
					blockId,
				}) satisfies DocumentOp),
				issues: [],
				reviewSafe: true,
			};
		}
	}
}

function buildOptimizedBlockReplacement(
	editor: Editor,
	targetBlockIds: string[],
	markdown: string,
): PlanExecutionResult | null {
	if (targetBlockIds.length === 0) {
		return null;
	}

	const targetBlocks = targetBlockIds
		.map((blockId) => editor.getBlock(blockId))
		.filter((block): block is NonNullable<typeof block> => block != null);
	if (targetBlocks.length !== targetBlockIds.length) {
		return null;
	}

	const parsedBlocks = buildDocumentWriteOps(editor, {
		format: "markdown",
		content: markdown,
		surface: "ai-flow-patch-optimize",
	}).blocks as PendingInlineBlock[];
	if (
		parsedBlocks.some((parsedBlock) => !isInlineConvertiblePendingBlock(parsedBlock))
	) {
		return null;
	}
	if (targetBlocks.some((block) => !isInlineConvertibleTargetBlock(block))) {
		return null;
	}

	const alignment = resolveInlineAlignmentPlan(targetBlocks, parsedBlocks);
	const ops = buildInlineAlignmentOps(alignment.steps, targetBlocks, parsedBlocks);

	return {
		ops,
		issues: [],
		reviewSafe: true,
		metrics: {
			flowPatchAlignment: alignment.metrics,
		},
	};
}

function buildInlineBlockRewriteOps(
	targetBlock: NonNullable<ReturnType<Editor["getBlock"]>>,
	parsedBlock: PendingInlineBlock,
): DocumentOp[] {
	const ops: DocumentOp[] = [];
	if (parsedBlock.type !== targetBlock.type) {
		ops.push({
			type: "convert-block",
			blockId: targetBlock.id,
			newType: parsedBlock.type,
			newProps: parsedBlock.props,
		});
	} else if (!areRecordValuesEqual(targetBlock.props, parsedBlock.props)) {
		ops.push({
			type: "update-block",
			blockId: targetBlock.id,
			props: parsedBlock.props,
		});
	}

	const nextText = parsedBlock.content ?? "";
	const needsTextRewrite =
		targetBlock.textContent() !== nextText || (parsedBlock.marks?.length ?? 0) > 0;
	if (needsTextRewrite) {
		ops.push({
			type: "replace-text",
			blockId: targetBlock.id,
			offset: 0,
			length: targetBlock.length(),
			text: nextText,
		});
		for (const mark of parsedBlock.marks ?? []) {
			if (mark.end <= mark.start) {
				continue;
			}
			ops.push({
				type: "format-text",
				blockId: targetBlock.id,
				offset: mark.start,
				length: mark.end - mark.start,
				marks: { [mark.type]: mark.props ?? true },
			});
		}
	}

	return ops;
}

function buildInlineAlignmentOps(
	alignment: InlineAlignmentStep[],
	targetBlocks: Array<NonNullable<ReturnType<Editor["getBlock"]>>>,
	parsedBlocks: PendingInlineBlock[],
): DocumentOp[] {
	const ops: DocumentOp[] = [];
	const pendingInserts: PendingInlineBlock[] = [];
	let blockBefore: string | null = null;

	for (const step of alignment) {
		if (step.kind === "insert") {
			pendingInserts.push(parsedBlocks[step.parsedIndex!]!);
			continue;
		}

		if (step.kind === "substitute") {
			const targetBlock = targetBlocks[step.targetIndex!]!;
			if (pendingInserts.length > 0) {
				const insertOps = buildInlinePendingBlockInsertOps(
					pendingInserts,
					resolveInsertionPosition(blockBefore, targetBlock.id),
				);
				ops.push(...insertOps);
				blockBefore = resolveLastInsertedBlockId(insertOps) ?? blockBefore;
				pendingInserts.length = 0;
			}
			ops.push(
				...buildInlineBlockRewriteOps(
					targetBlock,
					parsedBlocks[step.parsedIndex!]!,
				),
			);
			blockBefore = targetBlock.id;
			continue;
		}

		ops.push({
			type: "delete-block",
			blockId: targetBlocks[step.targetIndex!]!.id,
		});
	}

	if (pendingInserts.length > 0) {
		ops.push(
			...buildInlinePendingBlockInsertOps(
				pendingInserts,
				resolveInsertionPosition(blockBefore, null),
			),
		);
	}

	return ops;
}

function buildBlockUpdateExecution(
	editor: Editor,
	plan: BlockUpdatePlan,
	context: PlanExecutionContext,
): PlanExecutionResult {
	const blockState = resolveBlockState(editor, context, plan.blockId);
	if (!blockState) {
		return withIssue(
			`${plan.kind}.blockId`,
			"missing-block",
			`Block "${plan.blockId}" was not found.`,
		);
	}
	context.virtualBlocks.set(plan.blockId, {
		...blockState,
		props: plan.props,
	});

	return {
		ops: [{
			type: "update-block",
			blockId: plan.blockId,
			props: plan.props,
		}],
		issues: [],
		reviewSafe: false,
	};
}

function isInlineConvertiblePendingBlock(
	block: PendingInlineBlock,
): boolean {
	return (
		(block.children?.length ?? 0) === 0 &&
		block.database == null &&
		block.type !== "table" &&
		block.type !== "database"
	);
}

function isInlineConvertibleTargetBlock(
	block: NonNullable<ReturnType<Editor["getBlock"]>>,
): boolean {
	return block.children.length === 0 && block.type !== "table" && block.type !== "database";
}

function resolveInlineAlignmentPlan(
	targetBlocks: Array<NonNullable<ReturnType<Editor["getBlock"]>>>,
	parsedBlocks: PendingInlineBlock[],
): InlineAlignmentResolution {
	const costs = Array.from(
		{ length: targetBlocks.length + 1 },
		() => new Array<number>(parsedBlocks.length + 1).fill(0),
	);

	for (let targetIndex = targetBlocks.length - 1; targetIndex >= 0; targetIndex -= 1) {
		costs[targetIndex]![parsedBlocks.length] =
			estimateInlineDeleteCost(targetBlocks[targetIndex]!) +
			costs[targetIndex + 1]![parsedBlocks.length]!;
	}
	for (let parsedIndex = parsedBlocks.length - 1; parsedIndex >= 0; parsedIndex -= 1) {
		costs[targetBlocks.length]![parsedIndex] =
			estimateInlineInsertCost(parsedBlocks[parsedIndex]!) +
			costs[targetBlocks.length]![parsedIndex + 1]!;
	}

	for (let targetIndex = targetBlocks.length - 1; targetIndex >= 0; targetIndex -= 1) {
		for (let parsedIndex = parsedBlocks.length - 1; parsedIndex >= 0; parsedIndex -= 1) {
			const substituteCost =
				estimateInlineSubstituteCost(
					targetBlocks[targetIndex]!,
					parsedBlocks[parsedIndex]!,
				) + costs[targetIndex + 1]![parsedIndex + 1]!;
			const deleteCost =
				estimateInlineDeleteCost(targetBlocks[targetIndex]!) +
				costs[targetIndex + 1]![parsedIndex]!;
			const insertCost =
				estimateInlineInsertCost(parsedBlocks[parsedIndex]!) +
				costs[targetIndex]![parsedIndex + 1]!;
			costs[targetIndex]![parsedIndex] = Math.min(
				substituteCost,
				deleteCost,
				insertCost,
			);
		}
	}

	const alignment: InlineAlignmentStep[] = [];
	let targetIndex = 0;
	let parsedIndex = 0;
	while (targetIndex < targetBlocks.length && parsedIndex < parsedBlocks.length) {
		const bestCost = costs[targetIndex]![parsedIndex]!;
		const substituteCost =
			estimateInlineSubstituteCost(
				targetBlocks[targetIndex]!,
				parsedBlocks[parsedIndex]!,
			) + costs[targetIndex + 1]![parsedIndex + 1]!;
		const deleteCost =
			estimateInlineDeleteCost(targetBlocks[targetIndex]!) +
			costs[targetIndex + 1]![parsedIndex]!;
		const insertCost =
			estimateInlineInsertCost(parsedBlocks[parsedIndex]!) +
			costs[targetIndex]![parsedIndex + 1]!;

		if (
			substituteCost === bestCost &&
			shouldPreferInlineSubstitution(
				targetBlocks[targetIndex]!,
				parsedBlocks[parsedIndex]!,
				substituteCost,
				deleteCost,
				insertCost,
			)
		) {
			alignment.push({
				kind: "substitute",
				targetIndex,
				parsedIndex,
			});
			targetIndex += 1;
			parsedIndex += 1;
			continue;
		}

		if (deleteCost === bestCost && deleteCost <= insertCost) {
			alignment.push({
				kind: "delete",
				targetIndex,
			});
			targetIndex += 1;
			continue;
		}
		alignment.push({
			kind: "insert",
			parsedIndex,
		});
		parsedIndex += 1;
	}

	while (targetIndex < targetBlocks.length) {
		alignment.push({
			kind: "delete",
			targetIndex,
		});
		targetIndex += 1;
	}
	while (parsedIndex < parsedBlocks.length) {
		alignment.push({
			kind: "insert",
			parsedIndex,
		});
		parsedIndex += 1;
	}

	return {
		steps: alignment,
		metrics: summarizeInlineAlignment(alignment, targetBlocks, parsedBlocks, costs[0]?.[0] ?? 0),
	};
}

function shouldPreferInlineSubstitution(
	targetBlock: NonNullable<ReturnType<Editor["getBlock"]>>,
	parsedBlock: PendingInlineBlock,
	substituteCost: number,
	deleteCost: number,
	insertCost: number,
): boolean {
	if (substituteCost < deleteCost && substituteCost < insertCost) {
		return true;
	}
	if (substituteCost > deleteCost || substituteCost > insertCost) {
		return false;
	}
	return areBlocksReusableMatch(targetBlock, parsedBlock);
}

function estimateInlineSubstituteCost(
	targetBlock: NonNullable<ReturnType<Editor["getBlock"]>>,
	parsedBlock: PendingInlineBlock,
): number {
	return estimateInlineBlockRewriteCost(targetBlock, parsedBlock);
}

function estimateInlineDeleteCost(
	_targetBlock: NonNullable<ReturnType<Editor["getBlock"]>>,
): number {
	return 1;
}

function estimateInlineInsertCost(block: PendingInlineBlock): number {
	let cost = 1;
	if ((block.content ?? "").length > 0) {
		cost += 1;
	}
	for (const mark of block.marks ?? []) {
		if (mark.end > mark.start) {
			cost += 1;
		}
	}
	return cost;
}

function estimateInlineBlockRewriteCost(
	targetBlock: NonNullable<ReturnType<Editor["getBlock"]>>,
	parsedBlock: PendingInlineBlock,
): number {
	let cost = 0;
	if (parsedBlock.type !== targetBlock.type) {
		cost += 1;
	} else if (!areRecordValuesEqual(targetBlock.props, parsedBlock.props)) {
		cost += 1;
	}

	const nextText = parsedBlock.content ?? "";
	if (targetBlock.textContent() !== nextText || (parsedBlock.marks?.length ?? 0) > 0) {
		cost += 1;
	}
	for (const mark of parsedBlock.marks ?? []) {
		if (mark.end > mark.start) {
			cost += 1;
		}
	}
	return cost;
}

function summarizeInlineAlignment(
	alignment: InlineAlignmentStep[],
	targetBlocks: Array<NonNullable<ReturnType<Editor["getBlock"]>>>,
	parsedBlocks: PendingInlineBlock[],
	estimatedOperationCost: number,
): FlowPatchAlignmentMetrics {
	let preservedBlockCount = 0;
	let rewrittenBlockCount = 0;
	let unchangedBlockCount = 0;
	let insertedBlockCount = 0;
	let deletedBlockCount = 0;

	for (const step of alignment) {
		if (step.kind === "insert") {
			insertedBlockCount += 1;
			continue;
		}
		if (step.kind === "delete") {
			deletedBlockCount += 1;
			continue;
		}

		preservedBlockCount += 1;
		const rewriteCost = estimateInlineBlockRewriteCost(
			targetBlocks[step.targetIndex!]!,
			parsedBlocks[step.parsedIndex!]!,
		);
		if (rewriteCost > 0) {
			rewrittenBlockCount += 1;
		} else {
			unchangedBlockCount += 1;
		}
	}

	return {
		preservedBlockCount,
		rewrittenBlockCount,
		unchangedBlockCount,
		insertedBlockCount,
		deletedBlockCount,
		estimatedOperationCost,
	};
}

function mergeFlowPatchAlignmentMetrics(
	left: FlowPatchAlignmentMetrics | undefined,
	right: FlowPatchAlignmentMetrics | undefined,
): FlowPatchAlignmentMetrics | undefined {
	if (!left) {
		return right;
	}
	if (!right) {
		return left;
	}
	return {
		preservedBlockCount: left.preservedBlockCount + right.preservedBlockCount,
		rewrittenBlockCount: left.rewrittenBlockCount + right.rewrittenBlockCount,
		unchangedBlockCount: left.unchangedBlockCount + right.unchangedBlockCount,
		insertedBlockCount: left.insertedBlockCount + right.insertedBlockCount,
		deletedBlockCount: left.deletedBlockCount + right.deletedBlockCount,
		estimatedOperationCost:
			left.estimatedOperationCost + right.estimatedOperationCost,
	};
}

function areBlocksReusableMatch(
	targetBlock: NonNullable<ReturnType<Editor["getBlock"]>>,
	parsedBlock: PendingInlineBlock,
): boolean {
	return (
		targetBlock.type === parsedBlock.type &&
		areRecordValuesEqual(targetBlock.props, parsedBlock.props) &&
		areTextsReusableMatch(targetBlock.textContent(), parsedBlock.content ?? "")
	);
}

function areTextsReusableMatch(left: string, right: string): boolean {
	const normalizedLeft = normalizeReusableText(left);
	const normalizedRight = normalizeReusableText(right);
	if (normalizedLeft === normalizedRight) {
		return true;
	}
	if (normalizedLeft.length === 0 || normalizedRight.length === 0) {
		return false;
	}
	if (
		normalizedLeft.includes(normalizedRight) ||
		normalizedRight.includes(normalizedLeft)
	) {
		return true;
	}
	const sharedBoundaryLength =
		resolveSharedPrefixLength(normalizedLeft, normalizedRight) +
		resolveSharedSuffixLength(normalizedLeft, normalizedRight);
	const minLength = Math.min(normalizedLeft.length, normalizedRight.length);
	if (sharedBoundaryLength < Math.ceil(minLength * 0.5)) {
		return false;
	}
	const maxLength = Math.max(normalizedLeft.length, normalizedRight.length);
	const maxDistance = Math.max(4, Math.floor(maxLength * 0.4));
	return resolveLevenshteinDistance(normalizedLeft, normalizedRight, maxDistance) <= maxDistance;
}

function normalizeReusableText(text: string): string {
	return text.trim().replace(/\s+/g, " ").toLowerCase();
}

function resolveSharedPrefixLength(left: string, right: string): number {
	let index = 0;
	while (index < left.length && index < right.length && left[index] === right[index]) {
		index += 1;
	}
	return index;
}

function resolveSharedSuffixLength(left: string, right: string): number {
	let count = 0;
	while (
		count < left.length &&
		count < right.length &&
		left[left.length - 1 - count] === right[right.length - 1 - count]
	) {
		count += 1;
	}
	return count;
}

function resolveLevenshteinDistance(
	left: string,
	right: string,
	maxDistance: number,
): number {
	const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	const current = new Array<number>(right.length + 1);

	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		current[0] = leftIndex;
		let rowMin = current[0]!;
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
			current[rightIndex] = Math.min(
				current[rightIndex - 1]! + 1,
				previous[rightIndex]! + 1,
				previous[rightIndex - 1]! + substitutionCost,
			);
			rowMin = Math.min(rowMin, current[rightIndex]!);
		}
		if (rowMin > maxDistance) {
			return maxDistance + 1;
		}
		for (let index = 0; index <= right.length; index += 1) {
			previous[index] = current[index]!;
		}
	}

	return previous[right.length]!;
}

function buildInlinePendingBlockInsertOps(
	blocks: PendingInlineBlock[],
	position: { before: string } | { after: string } | "last",
): DocumentOp[] {
	const ops: DocumentOp[] = [];
	let currentPosition = position;
	for (const block of blocks) {
		const blockId = generateId();
		ops.push({
			type: "insert-block",
			blockId,
			blockType: block.type,
			props: block.props,
			position: currentPosition,
		});
		if ((block.content ?? "").length > 0) {
			ops.push({
				type: "insert-text",
				blockId,
				offset: 0,
				text: block.content!,
			});
		}
		for (const mark of block.marks ?? []) {
			if (mark.end <= mark.start) {
				continue;
			}
			ops.push({
				type: "format-text",
				blockId,
				offset: mark.start,
				length: mark.end - mark.start,
				marks: { [mark.type]: mark.props ?? true },
			});
		}
		currentPosition = { after: blockId };
	}
	return ops;
}

function resolveLastInsertedBlockId(ops: DocumentOp[]): string | null {
	for (let index = ops.length - 1; index >= 0; index -= 1) {
		const op = ops[index]!;
		if (op.type === "insert-block") {
			return op.blockId;
		}
	}
	return null;
}

function resolveInsertionPosition(
	blockBefore: string | null,
	blockAfter: string | null,
): { before: string } | { after: string } | "last" {
	if (blockBefore) {
		return { after: blockBefore };
	}
	if (blockAfter) {
		return { before: blockAfter };
	}
	return "last";
}

function areRecordValuesEqual(
	left: Record<string, unknown>,
	right: Record<string, unknown>,
): boolean {
	const leftEntries = Object.entries(left);
	const rightEntries = Object.entries(right);
	if (leftEntries.length !== rightEntries.length) {
		return false;
	}

	return leftEntries.every(([key, value]) => {
		if (!(key in right)) {
			return false;
		}
		return JSON.stringify(value) === JSON.stringify(right[key]);
	});
}

function buildBlockMoveExecution(
	editor: Editor,
	plan: BlockMovePlan,
	context: PlanExecutionContext,
): PlanExecutionResult {
	if (!resolveBlockState(editor, context, plan.blockId)) {
		return withIssue(
			`${plan.kind}.blockId`,
			"missing-block",
			`Block "${plan.blockId}" was not found.`,
		);
	}

	return {
		ops: [{
			type: "move-block",
			blockId: plan.blockId,
			position: plan.position,
		}],
		issues: [],
		reviewSafe: true,
	};
}

function buildBlockConvertExecution(
	editor: Editor,
	plan: BlockConvertPlan,
	context: PlanExecutionContext,
): PlanExecutionResult {
	const blockState = resolveBlockState(editor, context, plan.blockId);
	if (!blockState) {
		return withIssue(
			`${plan.kind}.blockId`,
			"missing-block",
			`Block "${plan.blockId}" was not found.`,
		);
	}
	context.virtualBlocks.set(
		plan.blockId,
		createVirtualBlockState(
			plan.newType,
			plan.props ?? blockState.props,
			blockState.textLength,
		),
	);

	return {
		ops: [{
			type: "convert-block",
			blockId: plan.blockId,
			newType: plan.newType,
			newProps: plan.props,
		}],
		issues: [],
		reviewSafe: true,
	};
}

function buildDatabaseEditExecution(
	editor: Editor,
	plan: DatabaseEditPlan,
	context: PlanExecutionContext,
): PlanExecutionResult {
	const block = editor.getBlock(plan.blockId);
	const virtualBlock = context.virtualBlocks.get(plan.blockId) ?? null;
	const effectiveBlockType = virtualBlock?.type ?? block?.type ?? null;
	if (!effectiveBlockType) {
		return withIssue(
			`${plan.kind}.blockId`,
			"missing-block",
			`Block "${plan.blockId}" was not found.`,
		);
	}
	if (effectiveBlockType !== "database") {
		return withIssue(
			`${plan.kind}.blockId`,
			"unsupported-target",
			`Block "${plan.blockId}" is not a database block.`,
		);
	}

	const ops: DocumentOp[] = [];
	const knownColumnIds = new Set<string>([
		...(block?.type === "database"
			? block.tableColumns().map((column) => column.id)
			: []),
		...(virtualBlock?.database?.columnIds ?? []),
	]);
	const knownRowIds = new Set<string>([
		...(block?.type === "database" ? readDatabaseRowIds(block) : []),
		...(virtualBlock?.database?.rowIds ?? []),
	]);
	const knownViewIds = new Set<string>([
		...(block?.type === "database"
			? block.databaseViews().map((view) => view.id)
			: []),
		...(virtualBlock?.database?.viewIds ?? []),
	]);

	for (const step of plan.steps) {
		switch (step.op) {
			case "add_column":
				ops.push({
					type: "database-add-column",
					blockId: plan.blockId,
					column: step.column,
				});
				knownColumnIds.add(step.column.id);
				break;
			case "update_column":
				ops.push({
					type: "database-update-column",
					blockId: plan.blockId,
					columnId: step.columnId,
					patch: step.patch,
				});
				break;
			case "insert_row": {
				const rowId = step.rowId ?? generateId();
				ops.push({
					type: "database-insert-row",
					blockId: plan.blockId,
					rowId,
					values: stringifyRecord(step.values),
				});
				knownRowIds.add(rowId);
				break;
			}
			case "update_cell":
				ops.push({
					type: "database-update-cell",
					blockId: plan.blockId,
					rowId: step.rowId,
					columnId: step.columnId,
					value: stringifyDatabaseValue(step.value),
				});
				break;
			case "add_view":
				ops.push({
					type: "database-add-view",
					blockId: plan.blockId,
					view: step.view,
				});
				knownViewIds.add(step.view.id);
				break;
			case "set_active_view":
				ops.push({
					type: "database-set-active-view",
					blockId: plan.blockId,
					viewId: step.viewId,
				});
				break;
		}
	}

	if (virtualBlock?.database) {
		virtualBlock.database.columnIds = knownColumnIds;
		virtualBlock.database.rowIds = knownRowIds;
		virtualBlock.database.viewIds = knownViewIds;
	}

	return {
		ops,
		issues: [],
		reviewSafe: false,
	};
}

function buildReviewBundleExecution(
	editor: Editor,
	plan: ReviewBundlePlan,
	context: PlanExecutionContext,
): PlanExecutionResult {
	const ops: DocumentOp[] = [];
	const issues: PlanExecutionIssue[] = [];
	let reviewSafe = true;

	for (let index = 0; index < plan.plans.length; index += 1) {
		const nestedPlan = plan.plans[index]!;
		const execution = buildPlanExecution(editor, nestedPlan, context);
		ops.push(...execution.ops);
		issues.push(
			...execution.issues.map((issue) => ({
				...issue,
				path: `${plan.kind}.plans[${index}].${issue.path}`,
			})),
		);
		reviewSafe &&= execution.reviewSafe;
	}

	return {
		ops,
		issues,
		reviewSafe,
	};
}

function createVirtualBlockState(
	blockType: string,
	props: Record<string, unknown> = {},
	text: string | number = 0,
): VirtualBlockState {
	const textLength = typeof text === "number" ? text : text.length;
	if (blockType === "database") {
		return {
			type: blockType,
			props,
			textLength,
			database: {
				columnIds: new Set(),
				rowIds: new Set(),
				viewIds: new Set(),
			},
		};
	}
	return {
		type: blockType,
		props,
		textLength,
	};
}

function resolveBlockState(
	editor: Editor,
	context: PlanExecutionContext,
	blockId: string,
): VirtualBlockState | null {
	const virtualBlock = context.virtualBlocks.get(blockId) ?? null;
	if (virtualBlock) {
		return virtualBlock;
	}

	const block = editor.getBlock(blockId);
	if (!block) {
		return null;
	}

	const nextState = createVirtualBlockState(
		block.type,
		{ ...block.props },
		block.length(),
	);
	if (block.type === "database") {
		nextState.database = {
			columnIds: new Set(block.tableColumns().map((column) => column.id)),
			rowIds: new Set(readDatabaseRowIds(block)),
			viewIds: new Set(block.databaseViews().map((view) => view.id)),
		};
	}
	return nextState;
}

function withIssue(
	path: string,
	code: PlanExecutionIssue["code"],
	message: string,
): PlanExecutionResult {
	return {
		ops: [],
		issues: [{ path, code, message }],
		reviewSafe: false,
	};
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

function readDatabaseRowIds(
	block: ReturnType<Editor["getBlock"]>,
): string[] {
	if (!block) {
		return [];
	}
	const rowIds: string[] = [];
	for (let index = 0; index < block.tableRowCount(); index += 1) {
		const rowId = block.tableRow(index)?.id;
		if (rowId) {
			rowIds.push(rowId);
		}
	}
	return rowIds;
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
