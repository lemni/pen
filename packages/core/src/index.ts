// ── Utility types ───────────────────────────────────────────

export type Unsubscribe = () => void;

// ── Branded ID types ────────────────────────────────────────

export type BlockId = string & { readonly __brand: "BlockId" };
export type AppId = string & { readonly __brand: "AppId" };
export type ZoneId = string & { readonly __brand: "ZoneId" };
export type DocId = string & { readonly __brand: "DocId" };

export function blockId(raw: string): BlockId { return raw as BlockId; }
export function appId(raw: string): AppId { return raw as AppId; }
export function zoneId(raw: string): ZoneId { return raw as ZoneId; }
export function docId(raw: string): DocId { return raw as DocId; }

// ── Origin ──────────────────────────────────────────────────

export type OpOrigin =
  | "user"
  | "ai"
  | "collaborator"
  | "extension"
  | "history"
  | "input-rule"
  | "app"
  | "import"
  | "system";

export interface ApplyOptions {
  origin?: OpOrigin;
  undoGroup?: boolean;
}

// ── Position ────────────────────────────────────────────────

export type Position =
  | { after: string }
  | { before: string }
  | { parent: string; index: number }
  | "first"
  | "last";

// ── Block ───────────────────────────────────────────────────

export interface Block<
  Type extends string = string,
  Props extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  type: Type;
  props: Props;
  content?: string;
  children?: Block[];
}

// ── App Placement ───────────────────────────────────────────

export type AnchorPosition =
  | "before"
  | "after"
  | "left"
  | "right"
  | "overlay";

export type AppPlacement =
  | { mode: "inline"; blockId: string; index: number }
  | { mode: "anchored"; blockId: string; anchor: AnchorPosition };

// ── App ─────────────────────────────────────────────────────

export interface App<
  Type extends string = string,
  Config extends Record<string, unknown> = Record<string, unknown>,
> {
  id: string;
  type: Type;
  config: Config;
  placement: AppPlacement;
}

// ── Range ───────────────────────────────────────────────────

export interface Range {
  index: number;
  length: number;
}

// ── Document Range ──────────────────────────────────────────

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

// ── Selection ───────────────────────────────────────────────

export type SelectionState =
  | TextSelection
  | BlockSelection
  | AppSelection
  | CellSelection
  | null;

export interface TextSelection {
  type: "text";
  anchor: { blockId: string; offset: number };
  focus: { blockId: string; offset: number };

  readonly isCollapsed: boolean;
  readonly isMultiBlock: boolean;
  readonly blockRange: string[];

  toRange(): DocumentRange;
}

export interface BlockSelection {
  type: "block";
  readonly blockIds: readonly string[];
}

export interface AppSelection {
  type: "app";
  appId: string;
}

export interface CellSelection {
  type: "cell";
  blockId: string;
  anchor: { row: number; col: number };
  head: { row: number; col: number };
}

// ── Serialization node types ────────────────────────────────

export interface MarkdownNode {
  type: string;
  children?: MarkdownNode[];
  value?: string;
  attributes?: Record<string, unknown>;
}

export interface XMLElement {
  tagName: string;
  attributes: Record<string, string>;
  children: XMLElement[];
  textContent?: string;
}

// ── Prop Schema (JSON Schema subset) ────────────────────────

export type PropSchema = {
  type?: string | string[];
  default?: unknown;
  enum?: unknown[];
  description?: string;
  properties?: Record<string, PropSchema>;
  items?: PropSchema;
  minimum?: number;
  maximum?: number;
  [key: string]: unknown;
};

// ── Content type ────────────────────────────────────────────

export type ContentType = "inline" | "none" | "table" | BlockSchema[];

export function isNestedContent(content: ContentType): content is BlockSchema[] {
  return Array.isArray(content);
}

// ── Layout ──────────────────────────────────────────────────

export interface LayoutSchema {
  modes: readonly ("flex" | "grid")[];
  defaultMode: "flex" | "grid";
  allowedChildren?: string[];
  minChildren?: number;
  maxChildren?: number;
}

export interface LayoutProps {
  display: "flex" | "grid";
  direction?: "row" | "column" | "row-reverse" | "column-reverse";
  wrap?: "nowrap" | "wrap" | "wrap-reverse";
  gap?: number | string;
  alignItems?: "start" | "center" | "end" | "stretch" | "baseline";
  justifyContent?:
  | "start"
  | "center"
  | "end"
  | "between"
  | "around"
  | "evenly";
  columns?: string;
  rows?: string;
  autoFlow?: "row" | "column" | "dense";
  padding?: Spacing;
  margin?: Spacing;
  background?: string;
  border?: BorderDef;
  borderRadius?: number | string;
  width?: string;
  maxWidth?: string;
  minHeight?: string;
  overflow?: "visible" | "hidden" | "auto";
}

export interface LayoutChildProps {
  flex?: string;
  alignSelf?: "start" | "center" | "end" | "stretch";
  order?: number;
  gridColumn?: string;
  gridRow?: string;
  colSpan?: number;
}

export type Spacing =
  | number
  | { top?: number; right?: number; bottom?: number; left?: number };

export type BorderDef = {
  width?: number;
  style?: string;
  color?: string;
};

// ── Block Schema ────────────────────────────────────────────

export type FieldEditorType =
  | "richtext"
  | "plaintext"
  | "code"
  | "none"
  | FieldEditorFactory;

export type FieldEditorFactory = (ctx: FieldEditorContext) => FieldEditor;

export interface BlockSchema<
  Type extends string = string,
  Props extends Record<string, PropSchema> = Record<string, PropSchema>,
  Content extends ContentType = "inline",
> {
  type: Type;
  propSchema: Props;
  content: Content;
  layout?: LayoutSchema;

  serialize: {
    toMarkdown?: (block: Block<Type, InferProps<Props>>) => string;
    fromMarkdown?: (node: MarkdownNode) => Block<Type, InferProps<Props>> | null;
    toHTML?: (block: Block<Type, InferProps<Props>>) => string;
    fromHTML?: (element: HTMLElement) => Block<Type, InferProps<Props>> | null;
    toXML?: (block: Block<Type, InferProps<Props>>) => string;
    fromXML?: (element: XMLElement) => Block<Type, InferProps<Props>> | null;
  };

  normalize?: (block: Block<Type, InferProps<Props>>) => Block<Type, InferProps<Props>>;
  validateProps?: (raw: Record<string, unknown>) => InferProps<Props>;
  fieldEditor?: FieldEditorType;
  keyBindings?: readonly KeyBinding[];
  display?: BlockDisplay;
  isContainer?: boolean;
  aiDescription?: string;
}

export interface BlockDisplay {
  title: string;
  description?: string;
  icon?: string;
  group?: string;
  aliases?: string[];
}

type InferProps<P extends Record<string, PropSchema>> = {
  [K in keyof P]: unknown;
};

// ── Inline Schema ───────────────────────────────────────────

export interface InlineSchema<
  Type extends string = string,
  Props extends Record<string, PropSchema> = Record<string, PropSchema>,
> {
  type: Type;
  propSchema: Props;
  kind: "mark" | "node";

  serialize: {
    toMarkdown?: (text: string, props: Record<string, unknown>) => string;
    fromMarkdown?: (node: MarkdownNode) => Record<string, unknown> | null;
    toHTML?: (text: string, props: Record<string, unknown>) => string;
    toXML?: (text: string, props: Record<string, unknown>) => string;
  };

  apply?(content: unknown, range: Range, value: unknown): void;
  remove?(content: unknown, range: Range): void;
  query?(content: unknown, index: number): unknown | null;

  priority?: number;
  expand?: "after" | "before" | "both" | "none";
  system?: boolean;
  aiDescription?: string;
}

// ── Schema Registry ─────────────────────────────────────────

export interface SchemaRegistry {
  resolve(type: string): BlockSchema | null;
  resolveInline(type: string): InlineSchema | null;
  resolveApp(type: string): AppSchema | null;
  resolveLayout(type: string): LayoutSchema | null;
  allBlocks(): readonly BlockSchema[];
  allInlines(): readonly InlineSchema[];
  allApps(): readonly AppSchema[];
  allBlockDisplays(): readonly (BlockSchema & { display: BlockDisplay })[];

  onUnknownBlock?: (
    type: string,
    raw: unknown,
  ) => BlockSchema | "drop" | "passthrough";

  onUnknownInline?: (
    type: string,
    raw: unknown,
  ) => InlineSchema | "drop" | "passthrough";
}

// ── Composable Schema ───────────────────────────────────────
// extend/without/override belong on the schema object, not the registry.

export interface ComposableSchema extends SchemaRegistry {
  extend(schemas: readonly (BlockSchema | InlineSchema)[]): ComposableSchema;
  without(types: readonly string[]): ComposableSchema;
  override(type: string, overrides: Partial<BlockSchema>): ComposableSchema;
  overrideSystemMark(type: string, schema: InlineSchema): ComposableSchema;
}

// ── App Schema ──────────────────────────────────────────────

export interface AppSchema<
  Type extends string = string,
  Config extends Record<string, PropSchema> = Record<string, PropSchema>,
> {
  type: Type;
  configSchema: Config;
  defaultPlacement: AppPlacement["mode"];
  allowedPlacements: AppPlacement["mode"][];
  onAnchorDeleted?: "delete" | "orphan";
  isolation?: "none" | "error-boundary" | "iframe";

  serialize: {
    toMarkdown?: (app: App<Type>) => string;
    toHTML?: (app: App<Type>) => string;
    toXML?: (app: App<Type>) => string;
  };

  aiDescription?: string;
}

// ── Block Handle ────────────────────────────────────────────

export interface BlockHandle {
  readonly id: string;
  readonly type: string;
  readonly props: Readonly<Record<string, unknown>>;
  readonly index: number;

  readonly prev: BlockHandle | null;
  readonly next: BlockHandle | null;
  readonly parent: BlockHandle | null;
  readonly children: readonly BlockHandle[];

  descendants(type?: string): Iterable<BlockHandle>;
  ancestors(): Iterable<BlockHandle>;
  siblings(): Iterable<BlockHandle>;

  readonly layout: LayoutProps | null;
  readonly isLayoutChild: boolean;
  layoutParent(): BlockHandle | null;

  anchoredApps(): readonly AppHandle[];

  textContent(options?: { resolved?: boolean }): string;
  textDeltas(): Array<{ insert: string; attributes?: Record<string, unknown> }>;
  length(): number;

  meta(namespace: string): Readonly<Record<string, unknown>> | null;
}

export interface AppHandle {
  readonly id: string;
  readonly type: string;
  readonly placement: AppPlacement;
  readonly config: Readonly<Record<string, unknown>>;
  readonly anchorBlock: BlockHandle | null;
}

// ── CRDT Abstract Collections ───────────────────────────────

export interface CRDTArray<T> {
  readonly length: number;
  get(index: number): T;
  toArray(): T[];
  [Symbol.iterator](): Iterator<T>;
}

export interface CRDTMap<T> {
  get(key: string): T | undefined;
  has(key: string): boolean;
  entries(): IterableIterator<[string, T]>;
  keys(): IterableIterator<string>;
  readonly size: number;
}

// ── Document State ──────────────────────────────────────────

export interface DocumentState {
  readonly blockOrder: readonly string[];
  readonly blockCount: number;
  readonly blocks: Iterable<BlockHandle>;
  readonly isEmpty: boolean;
  readonly generation: number;
  allBlocks(): Iterable<BlockHandle>;
  blockAt(index: number): string | null;
  indexOf(blockId: string): number;
  parentOf(blockId: string): string | null;
}

// ── CRDT Types ──────────────────────────────────────────────

export interface UndoManagerOptions {
  trackedOrigins?: OpOrigin[];
  captureTimeout?: number;
}

export interface CRDTAdapter {
  createDocument(): CRDTDocument;
  loadDocument(binary: Uint8Array): CRDTDocument;

  encodeState(doc: CRDTDocument): Uint8Array;
  encodeUpdate(doc: CRDTDocument, since?: Uint8Array): Uint8Array;
  applyUpdate(doc: CRDTDocument, update: Uint8Array): void;

  transact(doc: CRDTDocument, fn: () => void, origin?: string): void;

  createUndoManager(doc: CRDTDocument, options?: UndoManagerOptions): CRDTUndoManager;

  createAwareness?(doc: CRDTDocument): Awareness;

  observe(doc: CRDTDocument, callback: (event: CRDTEvent) => void): Unsubscribe;

  createSnapshot(doc: CRDTDocument): Uint8Array;
  restoreSnapshot(doc: CRDTDocument, snapshot: Uint8Array): CRDTDocument;

  mergeUpdates?(updates: Uint8Array[]): Uint8Array;

  fork?(doc: CRDTDocument): CRDTDocument;
  merge?(target: CRDTDocument, source: CRDTDocument): void;

  getClientId(doc: CRDTDocument): number;

  raw<T>(doc: CRDTDocument): T;

  createMap(): unknown;
  createArray(): unknown;
  createText(): unknown;
  initBlockMap(doc: CRDTDocument, blockId: string, blockType: string, contentType: "inline" | "nested" | "table" | "none"): unknown;

  getAttributionRanges?(doc: CRDTDocument, blockId: string): AttributionRange[];
}

export interface AttributionRange {
  offset: number;
  length: number;
  clientId: number;
}

export interface CRDTDocument {
  readonly adapter: CRDTAdapter;
}

export interface PenDocument {
  readonly blockOrder: CRDTArray<string>;
  readonly blocks: CRDTMap<unknown>;
  readonly apps: CRDTMap<unknown>;
  readonly metadata: CRDTMap<unknown>;
  readonly adapter: CRDTAdapter;
}

export interface CRDTUndoManager {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  stopCapturing(): void;
}

export interface AwarenessChangeEvent {
  added: number[];
  updated: number[];
  removed: number[];
}

export interface Awareness {
  getLocalState(): Record<string, unknown> | null;
  setLocalState(state: Record<string, unknown>): void;
  getStates(): Map<number, Record<string, unknown>>;
  on(event: "change", callback: (changes: AwarenessChangeEvent) => void): void;
  off(event: "change", callback: (changes: AwarenessChangeEvent) => void): void;
  destroy(): void;
}

// ── Generation Zone ─────────────────────────────────────────

export interface GenerationZone {
  id: string;
  blockId: string;
  range: DocumentRange;
  status: "idle" | "streaming" | "complete" | "error";
}

// ── CRDT Event ──────────────────────────────────────────────

export interface CRDTEvent {
  origin: OpOrigin;
  readonly affectedBlocks: readonly string[];
  ops: readonly DocumentOp[];
  timestamp: number;
}

// ── Document Operations ─────────────────────────────────────

export type DocumentOp =
  | InsertBlockOp
  | UpdateBlockOp
  | DeleteBlockOp
  | MoveBlockOp
  | ConvertBlockOp
  | SplitBlockOp
  | MergeBlocksOp
  | InsertTextOp
  | DeleteTextOp
  | FormatTextOp
  | ReplaceTextOp
  | InsertInlineNodeOp
  | RemoveInlineNodeOp
  | UpdateLayoutOp
  | InsertTableRowOp
  | DeleteTableRowOp
  | InsertTableColumnOp
  | DeleteTableColumnOp
  | MergeTableCellsOp
  | SplitTableCellOp
  | SetMetaOp
  | CreateAppOp
  | UpdateAppOp
  | DeleteAppOp
  | SetSelectionOp;

export interface InsertBlockOp {
  type: "insert-block";
  blockId: string;
  blockType: string;
  props: Record<string, unknown>;
  position: Position;
}
export interface UpdateBlockOp {
  type: "update-block";
  blockId: string;
  props: Record<string, unknown>;
}
export interface DeleteBlockOp {
  type: "delete-block";
  blockId: string;
}
export interface MoveBlockOp {
  type: "move-block";
  blockId: string;
  position: Position;
}
export interface ConvertBlockOp {
  type: "convert-block";
  blockId: string;
  newType: string;
  newProps?: Record<string, unknown>;
}
export interface SplitBlockOp {
  type: "split-block";
  blockId: string;
  offset: number;
  newBlockId: string;
  newBlockType?: string;
}
export interface MergeBlocksOp {
  type: "merge-blocks";
  targetBlockId: string;
  sourceBlockId: string;
}
export interface InsertTextOp {
  type: "insert-text";
  blockId: string;
  offset: number;
  text: string;
  marks?: Record<string, unknown>;
}
export interface DeleteTextOp {
  type: "delete-text";
  blockId: string;
  offset: number;
  length: number;
}
export interface FormatTextOp {
  type: "format-text";
  blockId: string;
  offset: number;
  length: number;
  marks: Record<string, unknown>;
}
export interface UpdateLayoutOp {
  type: "update-layout";
  blockId: string;
  layout: Partial<LayoutProps>;
}
export interface CreateAppOp {
  type: "create-app";
  appId: string;
  appType: string;
  config: Record<string, unknown>;
  placement: AppPlacement;
}
export interface UpdateAppOp {
  type: "update-app";
  appId: string;
  patch: Record<string, unknown>;
}
export interface DeleteAppOp {
  type: "delete-app";
  appId: string;
}
export interface ReplaceTextOp {
  type: "replace-text";
  blockId: string;
  offset: number;
  length: number;
  text: string;
  marks?: Record<string, unknown>;
}
export interface InsertInlineNodeOp {
  type: "insert-inline-node";
  blockId: string;
  offset: number;
  nodeType: string;
  props: Record<string, unknown>;
}
export interface RemoveInlineNodeOp {
  type: "remove-inline-node";
  blockId: string;
  offset: number;
}
export interface InsertTableRowOp { type: "insert-table-row"; blockId: string; index: number }
export interface DeleteTableRowOp { type: "delete-table-row"; blockId: string; index: number }
export interface InsertTableColumnOp { type: "insert-table-column"; blockId: string; index: number }
export interface DeleteTableColumnOp { type: "delete-table-column"; blockId: string; index: number }
export interface MergeTableCellsOp {
  type: "merge-table-cells";
  blockId: string;
  anchor: { row: number; col: number };
  head: { row: number; col: number };
}
export interface SplitTableCellOp {
  type: "split-table-cell";
  blockId: string;
  row: number;
  col: number;
}
export interface SetMetaOp {
  type: "set-meta";
  blockId: string;
  namespace: string;
  data: Record<string, unknown> | null;
}
export interface SetSelectionOp {
  type: "set-selection";
  selection: SelectionState;
}

// ── Stream Types ────────────────────────────────────────────

export type PenStreamPart =
  | GenStartPart
  | GenDeltaPart
  | GenEndPart
  | BlockInsertPart
  | BlockUpdatePart
  | BlockDeletePart
  | BlockMovePart
  | LayoutUpdatePart
  | AppCreatePart
  | AppUpdatePart
  | AppDeletePart
  | StepStartPart
  | StepEndPart
  | ToolInputStartPart
  | ToolInputDeltaPart
  | ToolInputAvailablePart
  | ToolOutputPart
  | ToolErrorPart
  | DataPart
  | ErrorPart
  | AbortPart
  | PingPart
  | DonePart;

export interface GenStartPart { type: "gen-start"; zoneId: string; blockId: string }
export interface GenDeltaPart { type: "gen-delta"; zoneId: string; delta: string }
export interface GenEndPart { type: "gen-end"; zoneId: string; status: "complete" | "cancelled" | "error" }
export interface BlockInsertPart { type: "block-insert"; blockId: string; blockType: string; props?: Record<string, unknown>; position: Position }
export interface BlockUpdatePart { type: "block-update"; blockId: string; props: Record<string, unknown> }
export interface BlockDeletePart { type: "block-delete"; blockId: string }
export interface BlockMovePart { type: "block-move"; blockId: string; position: Position }
export interface LayoutUpdatePart { type: "layout-update"; blockId: string; layout: Partial<LayoutProps> }
export interface AppCreatePart { type: "app-create"; appId: string; appType: string; config: Record<string, unknown>; placement: AppPlacement }
export interface AppUpdatePart { type: "app-update"; appId: string; patch: Record<string, unknown> }
export interface AppDeletePart { type: "app-delete"; appId: string }
export interface StepStartPart { type: "step-start"; stepIndex: number; label?: string }
export interface StepEndPart { type: "step-end"; stepIndex: number }
export interface ToolInputStartPart { type: "tool-input-start"; toolCallId: string; toolName: string }
export interface ToolInputDeltaPart { type: "tool-input-delta"; toolCallId: string; inputDelta: string }
export interface ToolInputAvailablePart { type: "tool-input-available"; toolCallId: string; toolName: string; input: unknown }
export interface ToolOutputPart { type: "tool-output"; toolCallId: string; output: unknown }
export interface ToolErrorPart { type: "tool-error"; toolCallId: string; error: string }
export interface DataPart { type: `data-${string}`; id?: string; data: unknown; transient?: boolean }
export interface ErrorPart { type: "error"; errorText: string; code?: string }
export interface AbortPart { type: "abort"; reason: string }
export interface PingPart { type: "ping" }
export interface DonePart { type: "done" }

export interface PenStreamRequest {
  prompt: string;
  context?: {
    editor?: unknown;
    docId?: string;
    selection?: SelectionState;
    blockId?: string;
  };
  tools?: ToolSchema[];
  toolCalls?: Array<{
    toolCallId: string;
    name: string;
    input: unknown;
  }>;
  messages?: ModelMessage[];
  signal?: AbortSignal;
  streamId?: string;
}

// ── Transport ───────────────────────────────────────────────

export interface PenTransport {
  stream(request: PenStreamRequest): AsyncIterable<PenStreamPart>;
  reconnect?(streamId: string): AsyncIterable<PenStreamPart>;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  readonly connected: boolean;
  onConnectionChange(callback: (connected: boolean) => void): Unsubscribe;
}

// ── Field Editor ────────────────────────────────────────────

export interface FieldEditor {
  readonly activeBlockId: string | null;
  readonly activeBlockIds: readonly string[];
  readonly isEditing: boolean;
  readonly inputMode: "richtext" | "code" | "table" | "none";
  selection: SelectionState | null;

  focus(): void;
  blur(): void;
  activate(blockId: string): void;
  deactivate(): void;

  expandTo(blockId: string): void;
  contractToFocused(): void;

  attachElement(el: HTMLElement): void;
  delegate(blockSchema: BlockSchema): boolean;

  destroy(): void;

  onActivate(callback: (blockIds: string[]) => void): Unsubscribe;
  onDeactivate(callback: (blockIds: string[]) => void): Unsubscribe;
  onSelectionChange(callback: (selection: SelectionState) => void): Unsubscribe;
}

export interface FieldEditorContext {
  blockId: string;
  schema: BlockSchema;
  editor: Editor;
}

// ── Decoration Engine ───────────────────────────────────────

export type Decoration =
  | InlineDecoration
  | BlockDecoration
  | AppDecoration;

export interface InlineDecoration {
  type: "inline";
  blockId: string;
  from: number;
  to: number;
  attributes: Record<string, string | number | boolean>;
  key?: string;
}

export interface BlockDecoration {
  type: "block";
  blockId: string;
  attributes: Record<string, string | number | boolean>;
  position?: "before" | "after" | "wrap";
}

export interface AppDecoration {
  type: "app";
  blockId: string;
  offset: number;
  component: unknown;
  key: string;
}

export interface DecorationSet {
  readonly decorations: readonly Decoration[];
  readonly generation: number;

  forBlock(blockId: string): readonly Decoration[];
  inlineForBlock(blockId: string): readonly InlineDecoration[];

  equals(other: DecorationSet): boolean;
  map(mapping: PositionMapping): DecorationSet;
}

export function createDecorationSet(_decorations: Decoration[]): DecorationSet {
  throw new Error("Not implemented");
}

export function emptyDecorationSet(): DecorationSet {
  throw new Error("Not implemented");
}

export interface PositionMapping {
  readonly affectedBlocks: readonly string[];
  mapOffset(blockId: string, offset: number): number;
}

// ── Undo Manager ────────────────────────────────────────────

export interface UndoManager {
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;

  stopCapturing(): void;
  setGroupTimeout(ms: number): void;

  setTrackedOrigins(origins: OpOrigin[]): void;

  onStackChange(callback: () => void): Unsubscribe;
}

// ── Asset Provider ──────────────────────────────────────────

export interface AssetRef {
  id: string;
  url: string;
  mimeType: string;
  size: number;
}

export interface AssetUploadOptions {
  filename?: string;
  mimeType?: string;
  maxSize?: number;
  onProgress?: (progress: number) => void;
}

export interface AssetProvider {
  upload(file: File | Blob, options?: AssetUploadOptions): Promise<AssetRef>;
  resolve(ref: AssetRef): string;
  delete?(ref: AssetRef): Promise<void>;
}

// ── Extension Types ─────────────────────────────────────────

export interface ServerExtensionContext {
  editor: Editor;
  emit(event: string, payload?: unknown): void;
  getState<T>(name: string): T | undefined;
}

export interface ClientExtensionContext extends ServerExtensionContext {
  dom: Document;
}

export interface Extension {
  name: string;
  version: string;
  readonly dependencies?: readonly string[];

  activateServer?(ctx: ServerExtensionContext): Promise<void>;
  deactivateServer?(): Promise<void>;

  activateClient?(ctx: ClientExtensionContext): Promise<void>;
  deactivateClient?(): Promise<void>;

  observe?(events: CRDTEvent[], editor: Editor): void;
  decorations?(state: DocumentState, editor: Editor): DecorationSet;

  readonly inputRules?: readonly InputRule[];
  readonly keyBindings?: readonly KeyBinding[];

  state?: ExtensionStateSpec<unknown>;
}

export interface InputRuleContext {
  editor: Editor;
  blockId: string;
  blockType: string;
  textBefore: string;
  fullText: string;
}

export type InputRuleHandler = (
  match: RegExpMatchArray,
  context: InputRuleContext,
) => DocumentOp[] | null;

export interface InputRule {
  id: string;
  match: RegExp;
  handler: InputRuleHandler;
  blockTypes?: string[];
}

export interface KeyBinding {
  key: string;
  handler: (editor: Editor) => boolean;
  description?: string;
}

export interface ExtensionStateSpec<T> {
  init(editor: Editor): T;
  apply?(state: T, events: CRDTEvent[], editor: Editor): T;
}

// ── Tool Context ────────────────────────────────────────────

export interface ToolServer {
  registerTool(def: ToolDefinition): void;
  unregisterTool(name: string): void;
  listTools(): readonly ToolDefinition[];
  executeTool(name: string, input: unknown, ctx: ToolContext): Promise<unknown> | AsyncIterable<unknown>;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: PropSchema;
  handler: (input: unknown, ctx: ToolContext) => Promise<unknown> | AsyncIterable<unknown>;
}

export interface ModelAdapter {
  stream(options: {
    messages: ModelMessage[];
    tools: ToolSchema[];
    signal?: AbortSignal;
  }): AsyncIterable<ModelStreamEvent>;
}

export type ModelStreamEvent =
  | { type: "text-delta"; delta: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "done"; usage?: { promptTokens: number; completionTokens: number } }
  | { type: "error"; error: unknown };

export interface ToolSchema {
  name: string;
  description: string;
  inputSchema: PropSchema;
}

export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ModelMessagePart[];
  toolCallId?: string;
  toolName?: string;
}

export type ModelMessagePart =
  | { type: "text"; text: string }
  | { type: "tool-call"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-result"; toolCallId: string; result: unknown; isError?: boolean };

export interface ToolContext {
  readonly editor: Editor;
  readonly docId: string;
  emit(part: PenStreamPart): void;

  insertBlock(blockType: string, props: Record<string, unknown>, position: Position): string;
  updateBlock(blockId: string, props: Record<string, unknown>): void;
  deleteBlock(blockId: string): void;
  beginStreaming(zoneId: string, blockId: string): void;
  appendDelta(delta: string): void;
  endStreaming(status: "complete" | "cancelled" | "error"): void;
}

export interface CommandContext {
  editor: Editor;
  selection: SelectionState;
  activeBlock: BlockHandle | null;
}

// ── Server Config ───────────────────────────────────────────

export interface ServerConfig {
  port?: number;
  host?: string;
  transport?: "stdio" | "sse" | "ws";
}

// ── Schema Engine ───────────────────────────────────────────

export interface SchemaEngine {
  markDirty(blockId: string): void;
  normalizeDirty(): void;
  normalizeAll(): void;
}

// ── Editor Events ───────────────────────────────────────────

export interface PenEventMap {
  change: (events: CRDTEvent[]) => void;
  documentChange: (event: { ops: DocumentOp[]; origin: OpOrigin; affectedBlocks: string[] }) => void;
  decorationsChange: (generation: number) => void;
  selectionChange: (selection: SelectionState) => void;
  focus: (event: { blockId: string | null }) => void;
  blur: (event: { blockId: string | null }) => void;
  diagnostic: (event: DiagnosticEvent) => void;
  "crdt:corruption": (errors: DocumentValidationError[]) => void;
  "crdt:recovered": (method: "snapshot" | "repair" | "reimport") => void;
}

export interface DiagnosticEvent {
  level: "warn" | "error" | "info";
  source: string;
  message: string;
  code?: string;
  error?: unknown;
  [key: string]: unknown;
}

export interface DocumentValidationError {
  code:
    | "MISSING_SHARED_TYPE"
    | "INVALID_BLOCK_STRUCTURE"
    | "ORPHAN_BLOCK"
    | "DUPLICATE_BLOCK_ORDER"
    | "UNKNOWN_CONTENT_TYPE"
    | "MISSING_BLOCK_MAP_KEY";
  blockId?: string;
  message: string;
  severity: "error" | "warning";
}

// ── Editor Options ──────────────────────────────────────────

export interface CreateEditorOptions {
  schema?: SchemaRegistry;
  extensions?: Extension[];
  without?: string[];
  crdt?: CRDTAdapter;
  assets?: AssetProvider;
}

// ── Editor Interface ────────────────────────────────────────

export interface Editor {
  apply(ops: DocumentOp[], options?: ApplyOptions): void;
  applyWithOrigin(origin: OpOrigin, ...ops: DocumentOp[]): void;
  loadDocument(doc: CRDTDocument): void;

  onBeforeApply(
    hook: (ops: DocumentOp[], options: ApplyOptions) => DocumentOp[],
    options?: { priority?: number },
  ): Unsubscribe;

  readonly schema: SchemaRegistry;
  readonly selection: SelectionState;
  readonly documentState: DocumentState;
  readonly internals: EditorInternals;
  readonly clientId: number;

  blocks(type?: string): Iterable<BlockHandle>;
  getBlock(blockId: string): BlockHandle | null;
  firstBlock(): BlockHandle | null;
  lastBlock(): BlockHandle | null;
  blockCount(): number;

  setSelection(selection: SelectionState): void;
  getSelection(): SelectionState;
  selectBlock(blockId: string): void;
  selectBlocks(blockIds: string[]): void;
  selectText(blockId: string, from: number, to: number): void;
  selectAll(): void;

  getSelectedText(): string;
  getSelectedBlocks(): BlockHandle[];
  replaceSelection(content: string | Block[]): void;
  deleteSelection(): void;

  requestDecorationUpdate(): void;
  scrollToBlock?(blockId: string): void;

  onDocumentChange(callback: PenEventMap["documentChange"]): Unsubscribe;
  onSelectionChange(callback: PenEventMap["selectionChange"]): Unsubscribe;

  on<K extends keyof PenEventMap>(event: K, handler: PenEventMap[K]): Unsubscribe;
  on(event: string, handler: (...args: unknown[]) => void): Unsubscribe;

  readonly undoManager: UndoManager;

  getExtensionState<T>(name: string): T | undefined;

  normalizeAll(): void;
  destroy(): void;
}

export interface EditorInternals {
  readonly adapter: CRDTAdapter;
  readonly crdtDoc: CRDTDocument;
  readonly doc: PenDocument;
  readonly engine: SchemaEngine;
  readonly awareness: Awareness | null;
  getSlot<T>(key: string): T | undefined;
  setSlot(key: string, value: unknown): void;
}

// ── Prop Builder ────────────────────────────────────────────

export interface PropBuilder {
  string(): PropChain;
  number(): PropChain;
  boolean(): PropChain;
  enum(values: readonly (string | number)[]): PropChain;
  array(items: PropChain): PropChain;
  object(properties: Record<string, PropChain>): PropChain;
  json(): PropChain;
  optional(inner: PropChain): PropChain;
}

export interface PropChain {
  default(value: unknown): PropChain;
  describe(description: string): PropChain;
  min(value: number): PropChain;
  max(value: number): PropChain;
}

export const prop: PropBuilder = {
  string: () => ({}) as PropChain,
  number: () => ({}) as PropChain,
  boolean: () => ({}) as PropChain,
  enum: () => ({}) as PropChain,
  array: () => ({}) as PropChain,
  object: () => ({}) as PropChain,
  json: () => ({}) as PropChain,
  optional: () => ({}) as PropChain,
};

// ── defineBlock ─────────────────────────────────────────────

export function defineBlock<Type extends string>(
  type: Type,
  _config: Partial<Omit<BlockSchema<Type>, "type">>,
): BlockSchema<Type> {
  throw new Error("Not implemented");
}

// ── defineExtension ─────────────────────────────────────────

export function defineExtension(
  _config: Omit<Extension, "version"> & { version?: string },
): Extension {
  throw new Error("Not implemented");
}

// ── Persistence ─────────────────────────────────────────────

export interface PenPersistence {
  loadDocument(docId: string): Promise<Uint8Array | null>;
  saveSnapshot(docId: string, state: Uint8Array): Promise<void>;
  appendUpdate(docId: string, update: Uint8Array): Promise<void>;
  getUpdates(docId: string, since?: Uint8Array): Promise<Uint8Array[]>;
  compact(docId: string): Promise<void>;
  saveVersionSnapshot(docId: string, snapshot: Uint8Array, metadata: VersionMetadata): Promise<void>;
  listVersions(docId: string, options?: { limit?: number; before?: string }): Promise<VersionEntry[]>;
  loadVersion(docId: string, versionId: string): Promise<{ state: Uint8Array; snapshot: Uint8Array }>;
}

export interface VersionMetadata {
  label?: string;
  trigger: "auto" | "manual" | "ai-generation" | "import";
  clientId: number;
  timestamp: number;
}

export interface VersionEntry {
  id: string;
  metadata: VersionMetadata;
  createdAt: number;
}

// ── Serialization (Exporter / Importer) ─────────────────────

export interface Exporter<Output = string> {
  name: string;
  mimeType: string;
  fileExtension: string;
  export(editor: Editor, options?: ExportOptions): Output | Promise<Output>;
  exportFragment?(blocks: BlockHandle[], options?: ExportOptions): Output;
}

export interface ExportOptions {
  includeApps?: boolean;
  includeLayout?: boolean;
  includeMetadata?: boolean;
  includeSuggestions?: boolean;
  prettyPrint?: boolean;
}

export interface Importer<Input = string> {
  name: string;
  mimeType: string;
  import(input: Input, editor: Editor, options?: ImportOptions): void | Promise<void>;
}

export interface ImportOptions {
  position?: Position;
  replace?: boolean;
  validate?: boolean;
  normalize?: boolean;
}

// ── Block Suggestion ────────────────────────────────────────

export interface BlockSuggestion {
  id: string;
  action: "insert-block" | "delete-block" | "move-block" | "convert-block";
  author: string;
  authorType: "user" | "ai";
  createdAt: number;
  model?: string;
  previousState?: {
    type?: string;
    position?: Position;
    props?: Record<string, unknown>;
  };
}

// ── Block Render Context ────────────────────────────────────

export interface BlockRenderContext {
  editable: boolean;
  selected: boolean;
  decorations: readonly Decoration[];
  ref: unknown;
}

export type BlockRenderer<Props = Record<string, unknown>> = (
  block: BlockHandle,
  ctx: BlockRenderContext,
) => unknown;

// ── Input Backend / Streaming Target ────────────────────────

export interface InputBackend {
  activate(element: HTMLElement, ytext: unknown): void;
  deactivate(): void;
  updateSelection(relPos: unknown): void;
}

export interface StreamingTarget {
  readonly generationZone: GenerationZone | null;
  beginStreaming(zoneId: string, blockId: string): void;
  appendDelta(delta: string): void;
  endStreaming(status: "complete" | "cancelled" | "error"): void;
}

// ── Hook Priority Constants ─────────────────────────────────

export const HOOK_PRIORITY_AUTH       = 100;
export const HOOK_PRIORITY_SUGGEST    = 200;
export const HOOK_PRIORITY_INPUT_RULE = 300;
export const HOOK_PRIORITY_DEFAULT    = 500;

// ── mergeSchemas ────────────────────────────────────────────

export function mergeSchemas(
  ..._schemas: SchemaRegistry[]
): ComposableSchema {
  throw new Error("Not implemented");
}

// ── createEditor ────────────────────────────────────────────

export function createEditor(_options?: CreateEditorOptions): Editor {
  throw new Error("Not implemented");
}

// ── toZod ───────────────────────────────────────────────────

export function toZod(_schema: PropSchema): unknown {
  throw new Error("Not implemented");
}
