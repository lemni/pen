export interface InlinePlaceholderVisibilityOptions {
	blockTextEmpty: boolean;
	isDocumentEmpty: boolean;
	isFirstBlock: boolean;
	isFocusedBlock: boolean;
	hasEmptyPlaceholder: boolean;
	hasExplicitPlaceholder: boolean;
	hasSchemaPlaceholder: boolean;
	suppressPlaceholders: boolean;
}

export interface InlinePlaceholderVisibility {
	showDocumentPlaceholder: boolean;
	showExplicitPlaceholder: boolean;
	showBlockPlaceholder: boolean;
}

export function resolveInlinePlaceholderVisibility(
	options: InlinePlaceholderVisibilityOptions,
): InlinePlaceholderVisibility {
	if (options.suppressPlaceholders) {
		return {
			showDocumentPlaceholder: false,
			showExplicitPlaceholder: false,
			showBlockPlaceholder: false,
		};
	}

	const showDocumentPlaceholder =
		options.blockTextEmpty &&
		options.isFirstBlock &&
		options.isDocumentEmpty &&
		options.hasEmptyPlaceholder;
	const showExplicitPlaceholder =
		options.blockTextEmpty &&
		options.isFocusedBlock &&
		options.hasExplicitPlaceholder &&
		!showDocumentPlaceholder;
	const showBlockPlaceholder =
		options.blockTextEmpty &&
		options.isFocusedBlock &&
		!options.hasExplicitPlaceholder &&
		options.hasSchemaPlaceholder &&
		!showDocumentPlaceholder;

	return {
		showDocumentPlaceholder,
		showExplicitPlaceholder,
		showBlockPlaceholder,
	};
}
