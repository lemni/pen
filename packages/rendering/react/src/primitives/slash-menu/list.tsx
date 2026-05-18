import React from "react";
import { useSlashMenuContext } from "./root";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { SlashMenuGroup } from "./group";
import { SlashMenuItem } from "./item";

export interface SlashMenuListProps extends AsChildProps {
	ref?: React.Ref<HTMLElement>;
}

/**
 * Two modes:
 * - Auto mode (no children): populates from registry.allBlockDisplays()
 * - Manual mode (has children): consumer provides explicit items
 */
export function SlashMenuList(props: SlashMenuListProps) {
	const { children, ...rest } = props;
	const { items } = useSlashMenuContext();

	const hasManualChildren = React.Children.count(children) > 0;

	let content: React.ReactNode;
	if (hasManualChildren) {
		content = children;
	} else {
		const groups = new Map<string, typeof items>();
		for (const item of items) {
			const group = item.display.group ?? "Other";
			const existing = groups.get(group) ?? [];
			existing.push(item);
			groups.set(group, existing);
		}

		let globalIndex = 0;
		const groupElements = Array.from(groups.entries()).map(
			([group, groupItems]) => {
				const itemElements = groupItems.map((item) => {
					const idx = globalIndex++;
					return (
						<SlashMenuItem
							key={item.type}
							blockType={item.type}
							index={idx}
						>
							{item.display.title}
						</SlashMenuItem>
					);
				});
				return (
					<SlashMenuGroup key={group} heading={group}>
						{itemElements}
					</SlashMenuGroup>
				);
			},
		);

		content = groupElements;
	}

	const primitiveProps: Record<string, unknown> = {
		"data-pen-slash-menu-list": "",
		role: "listbox",
	};

	return renderAsChild({ ...rest, children: content }, "div", primitiveProps);
}
