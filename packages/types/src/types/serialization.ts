import type { BlockHandle } from "./handles";
import type { Editor } from "./editor";
import type { Position } from "./ops";

export interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  url?: string;
  alt?: string;
  title?: string | null;
  depth?: number;
  lang?: string | null;
  ordered?: boolean;
  start?: number | null;
  checked?: boolean | null;
  attributes?: Record<string, unknown>;
}

export interface HTMLImportTextNode {
  type: "text";
  textContent: string;
}

export interface HTMLImportElement {
  type: "element";
  tagName: string;
  attributes: Record<string, string>;
  children: HTMLImportNode[];
  textContent?: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

export type HTMLImportNode = HTMLImportElement | HTMLImportTextNode;

export interface XMLElement {
  tagName: string;
  attributes: Record<string, string>;
  children: XMLElement[];
  textContent?: string;
}

export interface Exporter<
  Output = string,
  Extra extends Record<string, unknown> = Record<string, never>,
> {
  name: string;
  mimeType: string;
  fileExtension: string;
  /**
   * Serialize the current document as it exists.
   *
   * Exporters are document-preservation surfaces, not authoring policy
   * surfaces: they should generally serialize existing blocks even when those
   * block types are hidden from menus or disallowed as new insertions in the
   * active documentProfile.
   */
  export(
    editor: Editor,
    options?: ExportOptions<Extra>,
  ): Output | Promise<Output>;
  exportFragment?(blocks: BlockHandle[], options?: ExportOptions<Extra>): Output;
}

export interface ExportOptions<
  Extra extends Record<string, unknown> = Record<string, never>,
> {
  /**
   * Export flags shape serialization output, but they do not redefine document
   * authoring policy. Use schema/profile-aware helpers on authoring surfaces
   * (menus, tools, paste/import) when deciding what users may insert.
   */
  includeApps?: boolean;
  includeLayout?: boolean;
  includeMetadata?: boolean;
  includeSuggestions?: boolean;
  prettyPrint?: boolean;
  extra?: Extra;
}

export interface Importer<Input = string, Parsed = unknown> {
  name: string;
  mimeType: string;
  parse?(input: Input, editor: Editor): Parsed | Promise<Parsed>;
  /**
   * Import is an authoring boundary. Implementations should normalize parsed
   * content against the active schema/documentProfile before applying writes so
   * callers can observe dropped or transformed content deterministically.
   */
  import(
    input: Input,
    editor: Editor,
    options?: ImportOptions,
  ): ImportResult | void | Promise<ImportResult | void>;
}

export interface ImportOptions {
  position?: Position;
  replace?: boolean;
  validate?: boolean;
  normalize?: boolean;
  undoGroup?: boolean;
}

export interface ImportResult {
  /**
   * Summary of import-side normalization. This reports what parsed content was
   * accepted into the current authoring surface; it may therefore differ from
   * what an exporter would serialize from an already-existing document.
   */
  parsedTopLevelBlockCount: number;
  importedTopLevelBlockCount: number;
  droppedBlockCount: number;
  droppedBlockTypes: string[];
  normalized: boolean;
}
