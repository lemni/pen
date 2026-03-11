import type { Editor } from "@pen/core";
import {
	getFlowCapabilityFromSchema,
	shouldShowBlockInDefaultMenus,
	type FlowBlockCapability,
} from "./flowCapabilities";

export interface ToolbarBlockTypeOption {
	value: string;
	label: string;
}

const FLOW_CAPABILITY_ORDER: Record<FlowBlockCapability, number> = {
	"flow-inline": 0,
	"flow-structural": 1,
	"flow-delegated": 2,
	"flow-disallowed": 3,
};

const DISPLAY_GROUP_ORDER: Record<string, number> = {
	basic: 0,
	lists: 1,
	media: 2,
	advanced: 3,
};

export function getDefaultToolbarBlockTypeOptions(
	editor: Editor,
): ToolbarBlockTypeOption[] {
	return editor.schema
		.allBlockDisplays()
		.filter((display) =>
			shouldShowBlockInDefaultMenus(editor.documentProfile, display),
		)
		.sort((a, b) => compareToolbarDisplays(editor, a, b))
		.map((display) => ({
			value: display.type,
			label: display.display.title,
		}));
}

function compareToolbarDisplays(
	editor: Editor,
	a: ReturnType<Editor["schema"]["allBlockDisplays"]>[number],
	b: ReturnType<Editor["schema"]["allBlockDisplays"]>[number],
): number {
	const capabilityDelta =
		getCapabilityOrder(a, editor) - getCapabilityOrder(b, editor);
	if (capabilityDelta !== 0) {
		return capabilityDelta;
	}

	const groupDelta = getGroupOrder(a.display.group) - getGroupOrder(b.display.group);
	if (groupDelta !== 0) {
		return groupDelta;
	}

	return a.display.title.localeCompare(b.display.title);
}

function getCapabilityOrder(
	display: ReturnType<Editor["schema"]["allBlockDisplays"]>[number],
	editor: Editor,
): number {
	const capability = getFlowCapabilityFromSchema(display);
	if (!capability) {
		return FLOW_CAPABILITY_ORDER["flow-inline"];
	}
	return FLOW_CAPABILITY_ORDER[capability];
}

function getGroupOrder(group: string | undefined): number {
	if (!group) {
		return Number.MAX_SAFE_INTEGER;
	}
	return DISPLAY_GROUP_ORDER[group] ?? Number.MAX_SAFE_INTEGER;
}
