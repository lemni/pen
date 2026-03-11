import type {
  CRDTArray,
  CRDTDocument,
  CRDTMap,
  DocumentState,
  DocumentProfile,
  PenDocument,
  SchemaRegistry,
  BlockHandle,
} from "@pen/types";
import { createBlockHandle } from "../schema/handles";

type CRDTBlockMap = CRDTMap<CRDTMap<unknown>>;

export class DocumentStateImpl implements DocumentState {
  private _positionIndex: Map<string, number>;
  private _parentIndex: Map<string, string>;
  private _blockOrder: string[];
  private _generation = 0;
  private _documentProfile: DocumentProfile;
  private _doc: PenDocument;
  private _crdtDoc: CRDTDocument;
  private readonly _registry: SchemaRegistry;

  constructor(
    doc: PenDocument,
    crdtDoc: CRDTDocument,
    registry: SchemaRegistry,
    documentProfile: DocumentProfile,
  ) {
    this._doc = doc;
    this._crdtDoc = crdtDoc;
    this._registry = registry;
    this._documentProfile = documentProfile;
    this._positionIndex = new Map();
    this._parentIndex = new Map();
    this._blockOrder = [];
    this.rebuild();
  }

  get blockOrder(): readonly string[] {
    return this._blockOrder;
  }

  get documentProfile(): DocumentProfile {
    return this._documentProfile;
  }

  get blockCount(): number {
    return this._blockOrder.length;
  }

  get generation(): number {
    return this._generation;
  }

  get isEmpty(): boolean {
    return this._blockOrder.length === 0;
  }

  get blocks(): Iterable<BlockHandle> {
    return this._iterateBlocks();
  }

  indexOf(blockId: string): number {
    return this._positionIndex.get(blockId) ?? -1;
  }

  blockAt(index: number): string | null {
    return this._blockOrder[index] ?? null;
  }

  parentOf(blockId: string): string | null {
    return this._parentIndex.get(blockId) ?? null;
  }

  *allBlocks(): Iterable<BlockHandle> {
    const seen = new Set<string>();
    for (const id of this._blockOrder) {
      if (seen.has(id)) continue;
      seen.add(id);
      yield createBlockHandle(
        id,
        this._doc,
        this._crdtDoc,
        this._registry,
      );
      yield* this._walkChildren(id, seen);
    }
  }

  rebuild(): void {
    const order = this._doc.blockOrder;
    this._blockOrder = [];
    this._positionIndex = new Map();
    this._parentIndex = new Map();

    for (let i = 0; i < order.length; i++) {
      const id = order.get(i) as string;
      this._blockOrder.push(id);
      this._positionIndex.set(id, i);
    }

    for (const [blockId, blockMap] of (
      this._doc.blocks as CRDTBlockMap
    ).entries()) {
      const props = blockMap.get("props") as CRDTMap<unknown> | undefined;
      if (props?.get?.("parentId")) {
        this._parentIndex.set(
          blockId,
          props.get("parentId") as string,
        );
      }
      const children = blockMap.get("children") as
        | CRDTArray<string>
        | undefined;
      if (children) {
        for (let i = 0; i < children.length; i++) {
          this._parentIndex.set(children.get(i), blockId);
        }
      }
    }

    this._generation++;
  }

  incrementalUpdate(affectedBlocks: readonly string[]): void {
    const orderLength = this._doc.blockOrder.length;
    if (orderLength !== this._blockOrder.length) {
      this.rebuild();
      return;
    }

    let needsRebuild = false;
    for (const blockId of affectedBlocks) {
      const cachedIndex = this._positionIndex.get(blockId);
      if (cachedIndex === undefined) {
        needsRebuild = true;
        break;
      }
      const actual = this._doc.blockOrder.get(cachedIndex) as string;
      if (actual !== blockId) {
        needsRebuild = true;
        break;
      }
      if (this._actualParentOf(blockId) !== this._parentIndex.get(blockId)) {
        needsRebuild = true;
        break;
      }
      if (this._childrenChanged(blockId)) {
        needsRebuild = true;
        break;
      }
    }

    if (needsRebuild) {
      this.rebuild();
    }
  }

  updateDocument(
    doc: PenDocument,
    crdtDoc: CRDTDocument,
    documentProfile: DocumentProfile,
  ): void {
    this._doc = doc;
    this._crdtDoc = crdtDoc;
    this._documentProfile = documentProfile;
    this.rebuild();
  }

	setDocumentProfile(documentProfile: DocumentProfile): void {
		if (this._documentProfile === documentProfile) {
			return;
		}
		this._documentProfile = documentProfile;
		this._generation++;
	}

  private *_iterateBlocks(): Iterable<BlockHandle> {
    for (const id of this._blockOrder) {
      yield createBlockHandle(
        id,
        this._doc,
        this._crdtDoc,
        this._registry,
      );
    }
  }

  private *_walkChildren(
    blockId: string,
    seen: Set<string>,
  ): Iterable<BlockHandle> {
    const blockMap = (this._doc.blocks as CRDTBlockMap).get(blockId);
    if (!blockMap) return;

    const children = blockMap.get("children") as
      | CRDTArray<string>
      | undefined;
    if (!children) return;

    for (let i = 0; i < children.length; i++) {
      const childId = children.get(i);
      if (seen.has(childId)) continue;
      seen.add(childId);
      yield createBlockHandle(
        childId,
        this._doc,
        this._crdtDoc,
        this._registry,
      );
      yield* this._walkChildren(childId, seen);
    }
  }

  private _actualParentOf(blockId: string): string | undefined {
    const blockMap = (this._doc.blocks as CRDTBlockMap).get(blockId);
    const props = blockMap?.get("props") as CRDTMap<unknown> | undefined;
    const parentId = props?.get?.("parentId");
    if (typeof parentId === "string") {
      return parentId;
    }

    for (const [candidateId, candidateMap] of (
      this._doc.blocks as CRDTBlockMap
    ).entries()) {
      const children = candidateMap.get("children") as
        | CRDTArray<string>
        | undefined;
      if (!children) continue;
      for (let i = 0; i < children.length; i++) {
        if (children.get(i) === blockId) {
          return candidateId;
        }
      }
    }

    return undefined;
  }

  private _childrenChanged(blockId: string): boolean {
    const blockMap = (this._doc.blocks as CRDTBlockMap).get(blockId);
    const children = blockMap?.get("children") as
      | CRDTArray<string>
      | undefined;
    if (!children) return false;

    for (let i = 0; i < children.length; i++) {
      const childId = children.get(i);
      if (this._parentIndex.get(childId) !== blockId) {
        return true;
      }
    }

    return false;
  }
}
