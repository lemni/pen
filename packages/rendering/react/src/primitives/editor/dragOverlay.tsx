import React from "react";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { useBlockDragSession } from "./blockDragSession";

export interface DragOverlayProps extends AsChildProps {
  ref?: React.Ref<HTMLElement>;
}

/**
 * Optional overlay primitive during block drag.
 * By default renders nothing — the browser's native drag ghost is used.
 * Consumers can mount this and provide children for custom overlay UI.
 */
export function EditorDragOverlay(props: DragOverlayProps) {
  const { state } = useBlockDragSession();

  if (typeof window === "undefined" || !state.active) return null;
  if (!props.children) return null;

  return renderAsChild(props, "div", {
    "data-pen-drag-overlay": "",
    "aria-hidden": "true",
    style: {
      position: "fixed",
      pointerEvents: "none",
      zIndex: 9999,
    },
  });
}
