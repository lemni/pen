import React from "react";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { useSuggestionMenuContext } from "./root";

export interface SuggestionMenuEmptyProps extends AsChildProps {
	ref?: React.Ref<HTMLElement>;
}

export function SuggestionMenuEmpty(props: SuggestionMenuEmptyProps) {
	const { items, open, status } = useSuggestionMenuContext();
	if (!open || status === "loading" || items.length > 0) {
		return null;
	}

	return renderAsChild(props, "div", {
		"data-pen-suggestion-menu-empty": "",
		role: "presentation",
	});
}
