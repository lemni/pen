import "./SlashMenu.css";
import type { Editor } from "@pen/types";
import { Pen, useSlashMenuContext, type SlashMenuState } from "@pen/react";

interface SlashMenuProps {
	editor: Editor;
}

type SlashMenuItemData = SlashMenuState["items"][number];

const EMPTY_RESULTS_MESSAGE = "No matching commands";
const BLOCK_TYPE_ICONS: Record<string, string> = {
	paragraph: "P",
	heading: "H",
	bulletListItem: "*",
	numberedListItem: "1.",
	checkListItem: "[]",
	blockquote: '"',
	codeBlock: "<>",
	divider: "---",
	callout: "!",
	table: "| |",
	image: "IMG",
	toggle: ">>",
};

function formatGroupLabel(group?: string) {
	if (!group) return "Other";
	return group
		.split(/[\s_-]+/)
		.filter(Boolean)
		.map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
		.join(" ");
}

function getItemIcon(item: SlashMenuItemData) {
	return (
		item.display.icon ??
		BLOCK_TYPE_ICONS[item.type] ??
		item.display.title.slice(0, 2).toUpperCase()
	);
}

export function SlashMenu({ editor }: SlashMenuProps) {
	return (
		<Pen.SlashMenu.Root editor={editor}>
			<Pen.SlashMenu.Content asChild>
				<div aria-label="Insert block">
					<SlashMenuContent />
				</div>
			</Pen.SlashMenu.Content>
		</Pen.SlashMenu.Root>
	);
}

function SlashMenuContent() {
	const { items } = useSlashMenuContext();
	const groupedItems = new Map<
		string,
		Array<{ index: number; item: SlashMenuItemData }>
	>();
	items.forEach((item, index) => {
		const groupLabel = formatGroupLabel(item.display.group);
		const groupEntries = groupedItems.get(groupLabel) ?? [];
		groupEntries.push({ item, index });
		groupedItems.set(groupLabel, groupEntries);
	});

	const slashMenuGroupItems = Array.from(groupedItems.entries()).map(
		([groupLabel, groupItems]) => {
			const groupItemElements = groupItems.map(({ item, index }) => {
				const itemAlias = item.display.aliases?.[0];

				return (
					<Pen.SlashMenu.Item
						key={item.type}
						blockType={item.type}
						index={index}
						asChild
					>
						<button
							type="button"
							onMouseDown={(event) => event.preventDefault()}
						>
							<span
								className="slash-menu-item-icon"
								aria-hidden="true"
							>
								{getItemIcon(item)}
							</span>
							<span className="slash-menu-item-content">
								<span className="slash-menu-item-title">
									{item.display.title}
								</span>
								<span className="slash-menu-item-description">
									{item.display.description ??
										"Insert this block"}
								</span>
							</span>
							{itemAlias ? (
								<span
									className="slash-menu-item-alias"
									aria-hidden="true"
								>
									/{itemAlias}
								</span>
							) : null}
						</button>
					</Pen.SlashMenu.Item>
				);
			});

			return (
				<Pen.SlashMenu.Group key={groupLabel} heading={groupLabel}>
					{groupItemElements}
				</Pen.SlashMenu.Group>
			);
		},
	);

	return (
		<>
			<Pen.SlashMenu.List asChild>
				<div id="playground-slash-menu-list">{slashMenuGroupItems}</div>
			</Pen.SlashMenu.List>
			<Pen.SlashMenu.Empty asChild>
				<div>{EMPTY_RESULTS_MESSAGE}</div>
			</Pen.SlashMenu.Empty>
		</>
	);
}
