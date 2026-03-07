import type { TextSelection } from "./selection.js";

export interface DocumentRange {
  start: { blockId: string; offset: number };
  end: { blockId: string; offset: number };

  readonly isMultiBlock: boolean;
  readonly blockRange: string[];

  contains(point: { blockId: string; offset: number }): boolean;
  overlaps(other: DocumentRange): boolean;
  equals(other: DocumentRange): boolean;
  toTextSelection(): TextSelection;
}
