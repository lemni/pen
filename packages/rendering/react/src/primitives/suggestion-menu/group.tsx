import React from "react";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";

export interface SuggestionMenuGroupProps extends AsChildProps {
	heading?: string;
	ref?: React.Ref<HTMLElement>;
}

export function SuggestionMenuGroup(props: SuggestionMenuGroupProps) {
	const { heading, children, ...rest } = props;
	const content = (
		<>
			{heading && (
				<div
					data-pen-suggestion-menu-group-heading=""
					role="presentation"
				>
					{heading}
				</div>
			)}
			{children}
		</>
	);

	return renderAsChild({ ...rest, children: content }, "div", {
		"data-pen-suggestion-menu-group": "",
		role: "group",
		"aria-label": heading,
	});
}
