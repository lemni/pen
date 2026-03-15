import React from "react";
import type { BlockHandle, BlockRenderContext } from "@pen/types";
import { InlineContent } from "../primitives/editor/inlineContent";

export function ParagraphRenderer(
  block: BlockHandle,
  ctx: BlockRenderContext,
): React.ReactElement {
  return (
    <div
      ref={ctx.ref as React.Ref<HTMLDivElement>}
      data-block-type="paragraph"
      data-selected={ctx.selected || undefined}
    >
      <InlineContent blockId={block.id} />
    </div>
  );
}
