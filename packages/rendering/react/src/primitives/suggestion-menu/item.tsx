import React from "react";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { useSuggestionMenuContext } from "./root";

export interface SuggestionMenuItemProps extends AsChildProps {
	index?: number;
	onSelect?: () => void;
	ref?: React.Ref<HTMLElement>;
	[key: string]: unknown;
}

export function SuggestionMenuItem(props: SuggestionMenuItemProps) {
	const { index, onSelect, ...rest } = props;
	const { confirm, select, selectedIndex } = useSuggestionMenuContext();
	const isSelected = index != null && index === selectedIndex;

	const handleClick = () => {
		if (onSelect) {
			onSelect();
			return;
		}
		confirm(index);
	};

	const handleMouseDown = (event: React.MouseEvent) => {
		event.preventDefault();
	};

	const handleMouseEnter = () => {
		if (index == null) {
			return;
		}
		select(index);
	};

	const primitiveProps: Record<string, unknown> = {
		"data-pen-suggestion-menu-item": "",
		"data-selected": isSelected || undefined,
		role: "option",
		"aria-selected": isSelected,
		onClick: handleClick,
		onMouseDown: handleMouseDown,
		onMouseEnter: handleMouseEnter,
	};

	return renderAsChild(rest, "div", primitiveProps);
}
