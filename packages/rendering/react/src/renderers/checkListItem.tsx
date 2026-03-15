import React from "react";
import type { BlockHandle, BlockRenderContext } from "@pen/types";
import { useEditorContext } from "../context/editorContext";
import { ListItemLayout } from "../utils/listItemLayout";

export function CheckListItemRenderer(
  block: BlockHandle,
  ctx: BlockRenderContext,
): React.ReactElement {
  const indent = (block.props?.indent as number) ?? 0;
  const checked = (block.props?.checked as boolean) ?? false;

  return (
    <ListItemLayout
      ref={ctx.ref as React.Ref<HTMLDivElement>}
      blockId={block.id}
      blockType="checkListItem"
      indent={indent}
      selected={ctx.selected}
      extraAttributes={{ "data-checked": checked || undefined }}
      marker={<CheckboxToggle blockId={block.id} checked={checked} />}
    />
  );
}

function CheckboxToggle({
  blockId,
  checked,
}: {
  blockId: string;
  checked: boolean;
}) {
  const { editor, readonly } = useEditorContext();

  const handleChange = () => {
    if (readonly) return;
    editor.apply([
      {
        type: "update-block",
        blockId,
        props: { checked: !checked },
      },
    ]);
  };

  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={handleChange}
      aria-label="Toggle checkbox"
    />
  );
}
