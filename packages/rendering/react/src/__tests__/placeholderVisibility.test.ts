import { describe, expect, it } from "vitest";
import {
	resolveInlinePlaceholderVisibility,
	type InlinePlaceholderVisibilityOptions,
} from "../utils/placeholderVisibility";

const baseOptions = {
	blockTextEmpty: true,
	isDocumentEmpty: false,
	isFirstBlock: false,
	isFocusedBlock: true,
	hasEmptyPlaceholder: true,
	hasExplicitPlaceholder: false,
	hasSchemaPlaceholder: true,
	suppressPlaceholders: false,
} satisfies InlinePlaceholderVisibilityOptions;

describe("resolveInlinePlaceholderVisibility", () => {
	it("suppresses all placeholder variants when requested", () => {
		expect(
			resolveInlinePlaceholderVisibility({
				...baseOptions,
				isDocumentEmpty: true,
				isFirstBlock: true,
				hasExplicitPlaceholder: true,
				suppressPlaceholders: true,
			}),
		).toEqual({
			showDocumentPlaceholder: false,
			showExplicitPlaceholder: false,
			showBlockPlaceholder: false,
		});
	});

	it("prefers the document placeholder for the first empty document block", () => {
		expect(
			resolveInlinePlaceholderVisibility({
				...baseOptions,
				isDocumentEmpty: true,
				isFirstBlock: true,
				hasExplicitPlaceholder: true,
			}),
		).toEqual({
			showDocumentPlaceholder: true,
			showExplicitPlaceholder: false,
			showBlockPlaceholder: false,
		});
	});

	it("shows explicit and schema placeholders only for focused empty blocks", () => {
		expect(
			resolveInlinePlaceholderVisibility({
				...baseOptions,
				hasExplicitPlaceholder: true,
			}),
		).toEqual({
			showDocumentPlaceholder: false,
			showExplicitPlaceholder: true,
			showBlockPlaceholder: false,
		});

		expect(resolveInlinePlaceholderVisibility(baseOptions)).toEqual({
			showDocumentPlaceholder: false,
			showExplicitPlaceholder: false,
			showBlockPlaceholder: true,
		});
	});
});
