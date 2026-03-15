import type { Editor } from "@pen/types";
import type {
	GenerationStructuredPreviewState,
	StructuredPreviewPatchOperation,
} from "../types";
import type { DocumentMutationPlan } from "./planTypes";
import {
	buildStructuralReviewItems,
	buildStructuredPreviewTargets,
} from "./reviewArtifacts";

export function buildGenerationStructuredPreviewState(
	editor: Editor,
	input: {
		planState: GenerationStructuredPreviewState["planState"];
		plan: DocumentMutationPlan;
	},
): GenerationStructuredPreviewState {
	return {
		planState: input.planState,
		plan: input.plan,
		reviewItems: buildStructuralReviewItems(editor, input.plan),
		targets: buildStructuredPreviewTargets(editor, input.plan),
	};
}

export function buildStructuredPreviewPatchOperations(
	previous: GenerationStructuredPreviewState | null,
	next: GenerationStructuredPreviewState,
): StructuredPreviewPatchOperation[] {
	if (!previous) {
		return [
			{ op: "add", path: "/planState", value: next.planState },
			{ op: "add", path: "/plan", value: next.plan },
			{ op: "add", path: "/reviewItems", value: next.reviewItems },
			{ op: "add", path: "/targets", value: next.targets },
		];
	}

	const operations: StructuredPreviewPatchOperation[] = [];
	if (previous.planState !== next.planState) {
		operations.push({
			op: "replace",
			path: "/planState",
			value: next.planState,
		});
	}
	operations.push(...buildPlanPatchOperations(previous.plan, next.plan, "/plan"));

	const reviewItemOperations = buildReviewItemPatchOperations(
		previous.reviewItems,
		next.reviewItems,
	);
	const targetOperations = buildJsonPatchOperations(
		previous.targets,
		next.targets,
		"/targets",
	);
	return [...operations, ...reviewItemOperations, ...targetOperations];
}

function buildPlanPatchOperations(
	previous: DocumentMutationPlan,
	next: DocumentMutationPlan,
	path: string,
): StructuredPreviewPatchOperation[] {
	if (previous.kind !== next.kind) {
		return [{
			op: "replace",
			path,
			value: next,
		}];
	}

	if (next.kind !== "review_bundle") {
		return buildJsonPatchOperations(previous, next, path);
	}

	const previousBundle = previous.kind === "review_bundle" ? previous : null;
	if (!previousBundle) {
		return [{
			op: "replace",
			path,
			value: next,
		}];
	}

	const operations: StructuredPreviewPatchOperation[] = [];
	if (previousBundle.label !== next.label) {
		operations.push({
			op: "replace",
			path: `${path}/label`,
			value: next.label,
		});
	}
	if (previousBundle.reason !== next.reason) {
		operations.push({
			op: "replace",
			path: `${path}/reason`,
			value: next.reason,
		});
	}
	if (!areStructuredPreviewValuesEqual(previousBundle.confidence, next.confidence)) {
		operations.push({
			op: next.confidence === undefined ? "remove" : "replace",
			path: `${path}/confidence`,
			value: next.confidence,
		});
	}

	const sharedLength = Math.min(previousBundle.plans.length, next.plans.length);
	for (let index = 0; index < sharedLength; index += 1) {
		const previousPlan = previousBundle.plans[index];
		const nextPlan = next.plans[index];
		if (!previousPlan || !nextPlan) {
			continue;
		}
		operations.push(
			...buildPlanPatchOperations(
				previousPlan,
				nextPlan,
				`${path}/plans/${index}`,
			),
		);
	}

	if (next.plans.length > previousBundle.plans.length) {
		for (let index = previousBundle.plans.length; index < next.plans.length; index += 1) {
			operations.push({
				op: "add",
				path: `${path}/plans/${index}`,
				value: next.plans[index],
			});
		}
	}

	if (next.plans.length < previousBundle.plans.length) {
		for (let index = previousBundle.plans.length - 1; index >= next.plans.length; index -= 1) {
			operations.push({
				op: "remove",
				path: `${path}/plans/${index}`,
			});
		}
	}

	return operations;
}

function buildJsonPatchOperations(
	previous: unknown,
	next: unknown,
	path: string,
): StructuredPreviewPatchOperation[] {
	if (areStructuredPreviewValuesEqual(previous, next)) {
		return [];
	}
	if (Array.isArray(previous) && Array.isArray(next)) {
		return buildArrayPatchOperations(previous, next, path);
	}
	if (isRecordValue(previous) && isRecordValue(next)) {
		return buildObjectPatchOperations(previous, next, path);
	}
	return [{
		op: "replace",
		path,
		value: next,
	}];
}

function buildObjectPatchOperations(
	previous: Record<string, unknown>,
	next: Record<string, unknown>,
	path: string,
): StructuredPreviewPatchOperation[] {
	const operations: StructuredPreviewPatchOperation[] = [];
	const previousKeys = new Set(
		Object.entries(previous)
			.filter(([, value]) => value !== undefined)
			.map(([key]) => key),
	);
	const nextKeys = new Set(
		Object.entries(next)
			.filter(([, value]) => value !== undefined)
			.map(([key]) => key),
	);

	for (const key of previousKeys) {
		if (nextKeys.has(key)) {
			continue;
		}
		operations.push({
			op: "remove",
			path: `${path}/${escapeJsonPointerSegment(key)}`,
		});
	}

	for (const key of nextKeys) {
		const childPath = `${path}/${escapeJsonPointerSegment(key)}`;
		if (!previousKeys.has(key)) {
			const nextValue = next[key];
			if (isRecordValue(nextValue)) {
				operations.push({
					op: "add",
					path: childPath,
					value: {},
				});
				operations.push(...buildObjectPatchOperations({}, nextValue, childPath));
				continue;
			}
			if (Array.isArray(nextValue)) {
				operations.push({
					op: "add",
					path: childPath,
					value: [],
				});
				operations.push(...buildArrayPatchOperations([], nextValue, childPath));
				continue;
			}
			operations.push({
				op: "add",
				path: childPath,
				value: nextValue,
			});
			continue;
		}

		operations.push(
			...buildJsonPatchOperations(previous[key], next[key], childPath),
		);
	}

	return operations;
}

function buildArrayPatchOperations(
	previous: readonly unknown[],
	next: readonly unknown[],
	path: string,
): StructuredPreviewPatchOperation[] {
	const operations: StructuredPreviewPatchOperation[] = [];
	const sharedLength = Math.min(previous.length, next.length);

	for (let index = 0; index < sharedLength; index += 1) {
		operations.push(
			...buildJsonPatchOperations(
				previous[index],
				next[index],
				`${path}/${index}`,
			),
		);
	}

	if (next.length > previous.length) {
		for (let index = previous.length; index < next.length; index += 1) {
			const childPath = `${path}/${index}`;
			const nextValue = next[index];
			if (isRecordValue(nextValue)) {
				operations.push({
					op: "add",
					path: childPath,
					value: {},
				});
				operations.push(...buildObjectPatchOperations({}, nextValue, childPath));
				continue;
			}
			if (Array.isArray(nextValue)) {
				operations.push({
					op: "add",
					path: childPath,
					value: [],
				});
				operations.push(...buildArrayPatchOperations([], nextValue, childPath));
				continue;
			}
			operations.push({
				op: "add",
				path: childPath,
				value: nextValue,
			});
		}
	}

	if (next.length < previous.length) {
		for (let index = previous.length - 1; index >= next.length; index -= 1) {
			operations.push({
				op: "remove",
				path: `${path}/${index}`,
			});
		}
	}

	return operations;
}

function buildReviewItemPatchOperations(
	previous: GenerationStructuredPreviewState["reviewItems"],
	next: GenerationStructuredPreviewState["reviewItems"],
): StructuredPreviewPatchOperation[] {
	if (previous.length === 0 && next.length > 0) {
		return [{
			op: "add",
			path: "/reviewItems",
			value: next,
		}];
	}

	const operations: StructuredPreviewPatchOperation[] = [];
	const sharedLength = Math.min(previous.length, next.length);
	let prefixesMatch = true;
	for (let index = 0; index < sharedLength; index += 1) {
		if (previous[index]?.id !== next[index]?.id) {
			prefixesMatch = false;
			break;
		}
	}

	if (!prefixesMatch) {
		return [{
			op: "replace",
			path: "/reviewItems",
			value: next,
		}];
	}

	for (let index = 0; index < sharedLength; index += 1) {
		if (!areStructuredPreviewValuesEqual(previous[index], next[index])) {
			operations.push({
				op: "replace",
				path: `/reviewItems/${index}`,
				value: next[index],
			});
		}
	}

	if (next.length > previous.length) {
		for (let index = previous.length; index < next.length; index += 1) {
			operations.push({
				op: "add",
				path: `/reviewItems/${index}`,
				value: next[index],
			});
		}
	}

	if (next.length < previous.length) {
		for (let index = previous.length - 1; index >= next.length; index -= 1) {
			operations.push({
				op: "remove",
				path: `/reviewItems/${index}`,
			});
		}
	}

	return operations;
}

function areStructuredPreviewValuesEqual(previous: unknown, next: unknown): boolean {
	if (previous === next) {
		return true;
	}
	if (!previous || !next) {
		return previous === next;
	}

	try {
		return JSON.stringify(previous) === JSON.stringify(next);
	} catch {
		return false;
	}
}

function escapeJsonPointerSegment(value: string): string {
	return value.replaceAll("~", "~0").replaceAll("/", "~1");
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
