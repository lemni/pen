import React from "react";
import { useBlockDragHandle } from "../../hooks/useBlockDragHandle";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";

export interface BlockHandleProps extends AsChildProps {
  blockId: string;
  ref?: React.Ref<HTMLElement>;
}

export function EditorBlockHandle(props: BlockHandleProps) {
  const { blockId, ...rest } = props;
  const { props: primitiveProps } = useBlockDragHandle(blockId);

  return renderAsChild(rest, "div", primitiveProps);
}
