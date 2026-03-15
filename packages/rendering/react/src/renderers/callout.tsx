import React from "react";
import type { BlockHandle, BlockRenderContext } from "@pen/types";
import { InlineContent } from "../primitives/editor/inlineContent";
import { ParentIdChildren } from "../primitives/editor/parentIdChildren";

export function CalloutRenderer(
  block: BlockHandle,
  ctx: BlockRenderContext,
): React.ReactElement {
  const calloutType = (block.props?.type as string) ?? "info";

  const iconMap: Record<string, string> = {
    info: "\u2139\uFE0F",
    warning: "\u26A0\uFE0F",
    error: "\u274C",
  };

  return (
    <div
      ref={ctx.ref as React.Ref<HTMLDivElement>}
      data-block-type="callout"
      data-callout-type={calloutType}
      data-selected={ctx.selected || undefined}
      role="note"
    >
      <span data-pen-callout-icon="" aria-hidden="true">
        {iconMap[calloutType] ?? iconMap.info}
      </span>
      <div data-pen-callout-body="">
        <InlineContent blockId={block.id} />
        <ParentIdChildren
          parentBlockId={block.id}
          containerProps={{ "data-pen-callout-children": "" }}
        />
      </div>
    </div>
  );
}
