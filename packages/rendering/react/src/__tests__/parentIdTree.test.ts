import { describe, expect, it } from "vitest";
import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { getInsertSiblingBlockOp } from "../utils/parentIdTree";

describe("@pen/react parentIdTree", () => {
	it("inserts sibling blocks after the full nested subtree and inherits parentId", () => {
		const editor = createEditor({
			preset: defaultPreset({
				documentOps: false,
				deltaStream: false,
				undo: false,
			}),
		});
		const parentToggleId = editor.firstBlock()!.id;
		const nestedToggleId = crypto.randomUUID();
		const nestedChildId = crypto.randomUUID();

		editor.apply([
			{
				type: "convert-block",
				blockId: parentToggleId,
				newType: "toggle",
				newProps: { open: true },
			},
			{
				type: "insert-block",
				blockId: nestedToggleId,
				blockType: "toggle",
				props: { open: true },
				position: { after: parentToggleId },
			},
			{
				type: "update-block",
				blockId: nestedToggleId,
				props: { parentId: parentToggleId },
			},
			{
				type: "insert-block",
				blockId: nestedChildId,
				blockType: "paragraph",
				props: {},
				position: { after: nestedToggleId },
			},
			{
				type: "update-block",
				blockId: nestedChildId,
				props: { parentId: nestedToggleId },
			},
		]);

		const insertedBlockId = crypto.randomUUID();
		const insertOp = getInsertSiblingBlockOp(editor, {
			siblingBlockId: nestedToggleId,
			blockId: insertedBlockId,
			blockType: "heading",
		});

		expect(insertOp).toMatchObject({
			type: "insert-block",
			blockId: insertedBlockId,
			blockType: "heading",
			props: { parentId: parentToggleId },
			position: { after: nestedChildId },
		});

		editor.destroy();
	});
});
