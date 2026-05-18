import type {
	CreateEditorOptions,
	CRDTDocument,
	Editor,
	PenDocument,
	SchemaRegistry,
	BlockHandle,
} from "@pen/types";
import type * as Y from "yjs";

export interface TestBlock {
	id?: string;
	type: string;
	props?: Record<string, unknown>;
	content?: string;
	children?: TestBlock[];
}

export interface TestEditorOptions extends Partial<CreateEditorOptions> {
	blocks?: TestBlock[];
	doc?: Y.Doc;
}

export interface TestEditor extends Editor {
	readonly document: PenDocument;
	readonly ydoc: Y.Doc;
	readonly crdtDoc: CRDTDocument;

	getBlock(blockId: string): BlockHandle;
	simulateKeypress(key: string): void;
	simulateTyping(text: string): void;
	normalizeAll(): void;
	markDirty(blockId: string): void;
	normalizeDirty(): void;
}

export interface TestCollaboration {
	editorA: TestEditor;
	editorB: TestEditor;
	sync(): void;
}

export type NormalizedYjsValue =
	| null
	| boolean
	| number
	| string
	| NormalizedYjsValue[]
	| { [key: string]: NormalizedYjsValue };

export type YjsRootType = "array" | "map" | "text";

export interface YjsRootExpectation {
	name: string;
	type?: YjsRootType;
	optional?: boolean;
}

export interface NormalizedYDocSnapshot {
	roots: Record<string, NormalizedYjsValue>;
}

export interface DeterministicYDocFixtureOptions {
	blocks?: TestBlock[];
	clientId?: number;
	roots?: readonly YjsRootExpectation[];
	mutate?: (ydoc: Y.Doc) => void;
}

export interface DeterministicYDocFixture {
	ydoc: Y.Doc;
	doc: PenDocument;
	crdtDoc: CRDTDocument;
	update: Uint8Array;
	updateBase64: string;
	stateVector: Uint8Array;
	stateVectorBase64: string;
	snapshot: NormalizedYDocSnapshot;
}
