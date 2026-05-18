import React from "react";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";

export interface ToolbarSeparatorProps extends AsChildProps {
	ref?: React.Ref<HTMLElement>;
}

export function ToolbarSeparator(props: ToolbarSeparatorProps) {
	return renderAsChild(props, "div", {
		role: "separator",
		"data-pen-toolbar-separator": "",
	});
}
