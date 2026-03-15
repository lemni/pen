import type { BlockHandle, BlockRenderContext, BlockRenderer } from "@pen/types";
import { ParagraphRenderer } from "./paragraph";
import { HeadingRenderer } from "./heading";
import { BulletListItemRenderer } from "./bulletListItem";
import { NumberedListItemRenderer } from "./numberedListItem";
import { CheckListItemRenderer } from "./checkListItem";
import { CodeBlockRenderer } from "./codeBlock";
import { ImageRenderer } from "./image";
import { TableRenderer } from "./table";
import { DividerRenderer } from "./divider";
import { CalloutRenderer } from "./callout";
import { ToggleRenderer } from "./toggle";
import { BlockquoteRenderer } from "./blockquote";
import { SubdocumentRenderer } from "./subdocument";
import { DefaultRenderer } from "./defaultRenderer";

const RENDERER_MAP: Record<string, BlockRenderer> = {
  paragraph: ParagraphRenderer,
  heading: HeadingRenderer,
  bulletListItem: BulletListItemRenderer,
  numberedListItem: NumberedListItemRenderer,
  checkListItem: CheckListItemRenderer,
  codeBlock: CodeBlockRenderer,
  image: ImageRenderer,
  table: TableRenderer,
  divider: DividerRenderer,
  callout: CalloutRenderer,
  toggle: ToggleRenderer,
  blockquote: BlockquoteRenderer,
  subdocument: SubdocumentRenderer,
};

export function resolveRenderer(blockType: string): BlockRenderer {
  return RENDERER_MAP[blockType] ?? DefaultRenderer;
}

export function registerRenderer(
  blockType: string,
  renderer: BlockRenderer,
): void {
  RENDERER_MAP[blockType] = renderer;
}

export {
  ParagraphRenderer,
  HeadingRenderer,
  BulletListItemRenderer,
  NumberedListItemRenderer,
  CheckListItemRenderer,
  CodeBlockRenderer,
  ImageRenderer,
  TableRenderer,
  DividerRenderer,
  CalloutRenderer,
  ToggleRenderer,
  BlockquoteRenderer,
  SubdocumentRenderer,
  DefaultRenderer,
};

