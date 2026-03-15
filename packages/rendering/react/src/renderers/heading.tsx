import React from "react";
import type { BlockHandle, BlockRenderContext } from "@pen/types";
import { InlineContent } from "../primitives/editor/inlineContent";

export function HeadingRenderer(
  block: BlockHandle,
  ctx: BlockRenderContext,
): React.ReactElement {
  const level = (block.props?.level as number) ?? 1;

  return React.createElement(
    `h${Math.max(1, Math.min(6, level))}`,
    {
      ref: ctx.ref,
      "data-block-type": "heading",
      "data-level": level,
      "data-selected": ctx.selected || undefined,
    },
    <InlineContent blockId={block.id} />,
  );
}
