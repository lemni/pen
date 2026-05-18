import React from "react";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";

export interface SuggestionMenuListProps extends AsChildProps {
	ref?: React.Ref<HTMLElement>;
}

export function SuggestionMenuList(props: SuggestionMenuListProps) {
	return renderAsChild(props, "div", {
		"data-pen-suggestion-menu-list": "",
		role: "listbox",
	});
}
