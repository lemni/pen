import type {
  Editor,
  ToolContext,
  PenStreamPart,
  Position,
} from "@pen/types";
import { assertToolCanUseBlockType } from "./utils/blockTypePolicy";

export class ToolContextImpl implements ToolContext {
  readonly editor: Editor;
  readonly docId: string;
  private readonly _emitFn: (part: PenStreamPart) => void;
  private _activeZones = new Map<string, { blockId: string }>();

  constructor(
    editor: Editor,
    docId: string,
    emitFn: (part: PenStreamPart) => void,
  ) {
    this.editor = editor;
    this.docId = docId;
    this._emitFn = emitFn;
  }

  emit(part: PenStreamPart): void {
    this._emitFn(part);
  }

  insertBlock(
    blockType: string,
    props: Record<string, unknown>,
    position: Position,
  ): string {
    assertToolCanUseBlockType(this.editor, blockType);
    const blockId = crypto.randomUUID();

    this.emit({
      type: "block-insert",
      blockId,
      blockType,
      props,
      position,
    });

    this.editor.apply(
      [
        {
          type: "insert-block",
          blockId,
          blockType,
          props,
          position,
        },
      ],
      { origin: "ai" },
    );

    return blockId;
  }

  updateBlock(
    blockId: string,
    props: Record<string, unknown>,
  ): void {
    this.emit({
      type: "block-update",
      blockId,
      props,
    });

    this.editor.apply(
      [{ type: "update-block", blockId, props }],
      { origin: "ai" },
    );
  }

  deleteBlock(blockId: string): void {
    this.emit({
      type: "block-delete",
      blockId,
    });

    this.editor.apply(
      [{ type: "delete-block", blockId }],
      { origin: "ai" },
    );
  }

  beginStreaming(zoneId: string, blockId: string): void {
    this._activeZones.set(zoneId, { blockId });
    this.emit({ type: "gen-start", zoneId, blockId });

    const streaming = this.editor.internals.getSlot<{
      beginStreaming(zoneId: string, blockId: string): void;
    }>("delta-stream:target");
    if (streaming) {
      streaming.beginStreaming(zoneId, blockId);
    }
  }

  appendDelta(delta: string): void {
    // Zone ID is not tracked per-delta in the simple path;
    // the streaming target manages its own active zone.
    const streaming = this.editor.internals.getSlot<{
      appendDelta(delta: string): void;
    }>("delta-stream:target");
    if (streaming) {
      streaming.appendDelta(delta);
    }
  }

  endStreaming(
    status: "complete" | "cancelled" | "error",
  ): void {
    const streaming = this.editor.internals.getSlot<{
      endStreaming(status: "complete" | "cancelled" | "error"): void;
    }>("delta-stream:target");
    if (streaming) {
      streaming.endStreaming(status);
    }
  }
}
