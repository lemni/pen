import React from "react";
import type { BlockHandle, BlockRenderContext } from "@pen/types";

export function ImageRenderer(
  block: BlockHandle,
  ctx: BlockRenderContext,
): React.ReactElement {
  const src = (block.props?.src as string) ?? "";
  const alt = (block.props?.alt as string) ?? "";
  const caption = (block.props?.caption as string) ?? "";
  const width = block.props?.width as number | undefined;

  return (
    <figure
      ref={ctx.ref as React.Ref<HTMLElement>}
      data-block-type="image"
      data-selected={ctx.selected || undefined}
    >
      <img
        src={src}
        alt={alt}
        style={width ? { width: `${width}px` } : undefined}
      />
      {caption && <figcaption>{caption}</figcaption>}
    </figure>
  );
}
