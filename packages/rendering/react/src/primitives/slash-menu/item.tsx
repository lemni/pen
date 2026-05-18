import React from "react";
import { useSlashMenuContext } from "./root";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";

export interface SlashMenuItemProps extends AsChildProps {
	blockType?: string;
	index?: number;
	onSelect?: () => void;
	ref?: React.Ref<HTMLElement>;
	[key: string]: unknown;
}

export function SlashMenuItem(props: SlashMenuItemProps) {
	const { blockType, index, onSelect, ...rest } = props;
	const { confirm, select, selectedIndex } = useSlashMenuContext();
	const isSelected = index != null && index === selectedIndex;

	const handleClick = () => {
		if (onSelect) {
			onSelect();
		} else {
			confirm(index);
		}
	};

	const handleMouseEnter = () => {
		if (index == null) return;
		select(index);
	};

	const primitiveProps: Record<string, unknown> = {
		"data-pen-slash-menu-item": "",
		"data-block-type": blockType,
		"data-selected": isSelected || undefined,
		role: "option",
		"aria-selected": isSelected,
		onClick: handleClick,
		onMouseEnter: handleMouseEnter,
	};

	return renderAsChild(rest, "div", primitiveProps);
}
