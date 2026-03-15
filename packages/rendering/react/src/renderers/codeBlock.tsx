import React from "react";
import type { BlockHandle, BlockRenderContext } from "@pen/types";
import { InlineContent } from "../primitives/editor/inlineContent";

export function CodeBlockRenderer(
  block: BlockHandle,
  ctx: BlockRenderContext,
): React.ReactElement {
  const language = (block.props?.language as string) ?? "";

  return (
    <pre
      ref={ctx.ref as React.Ref<HTMLPreElement>}
      data-block-type="codeBlock"
      data-language={language || undefined}
      data-selected={ctx.selected || undefined}
    >
      <code className={language ? `language-${language}` : undefined}>
        <InlineContent blockId={block.id} />
      </code>
    </pre>
  );
}
