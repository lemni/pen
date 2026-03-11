import type {
  Awareness,
  CRDTAdapter,
  CRDTDocument,
  CRDTEvent,
  CreateSubdocumentOptions,
  DocumentScope,
  DocumentScopeLookupOptions,
  DocumentSession,
  Unsubscribe,
} from "@pen/types";
import {
  SUBDOCUMENT,
  createYjsSubdocument,
  isYjsDoc,
  isYjsMap,
  isYjsCRDTDocument,
  wrapYjsDocument,
  type YjsDoc,
  type YjsCRDTDocument,
} from "@pen/crdt-yjs";

type ScopeListener = (event: CRDTEvent) => void;

type ScopeEntry = {
  scope: DocumentScope;
  awareness: Awareness | null;
  observerUnsub: Unsubscribe;
  subdocsHandler: ((event: {
    added: Set<YjsDoc>;
    loaded: Set<YjsDoc>;
    removed: Set<YjsDoc>;
  }) => void) | null;
};

export interface CreateDocumentSessionOptions {
  adapter: CRDTAdapter;
  document?: CRDTDocument;
  destroyWhenIdle?: boolean;
  ownsDocuments?: boolean;
}

function getDocumentGuid(doc: YjsDoc): string {
  const guid = (doc as YjsDoc & { guid?: string }).guid;
  return typeof guid === "string" && guid.length > 0
    ? guid
    : `doc-${doc.clientID}`;
}

function toScopeId(doc: CRDTDocument): string {
  if (!isYjsCRDTDocument(doc)) {
    return `scope-${Math.random().toString(36).slice(2)}`;
  }
  return getDocumentGuid(doc.ydoc);
}

function cloneScope(scope: DocumentScope): DocumentScope {
  return { ...scope };
}

export class DocumentSessionImpl implements DocumentSession {
  readonly adapter: CRDTAdapter;
  readonly rootScope: DocumentScope;

  private readonly _destroyWhenIdle: boolean;
  private readonly _ownsDocuments: boolean;
  private readonly _scopes = new Map<string, ScopeEntry>();
  private readonly _guidToScopeId = new Map<string, string>();
  private readonly _scopeIdsByOwnerKey = new Map<string, string>();
  private readonly _listenersByScope = new Map<string, Set<ScopeListener>>();
  private readonly _allListeners = new Set<ScopeListener>();
  private _attachedEditors = 0;
  private _destroyed = false;

  constructor(options: CreateDocumentSessionOptions) {
    const { adapter } = options;
    const rootDoc = options.document ?? adapter.createDocument();
    this.adapter = adapter;
    this._destroyWhenIdle = options.destroyWhenIdle === true;
    this._ownsDocuments = options.ownsDocuments ?? options.document == null;
    this.rootScope = this._registerScope(rootDoc, {
      parentId: null,
      ownerBlockId: null,
    });
  }

  getScope(scopeId: string): DocumentScope | null {
    return this._getScope(scopeId);
  }

  getScopeByGuid(guid: string): DocumentScope | null {
    const scopeId = this._guidToScopeId.get(guid);
    return scopeId ? this._getScope(scopeId) : null;
  }

  getScopeForBlock(
    blockId: string,
    options?: DocumentScopeLookupOptions,
  ): DocumentScope | null {
    const scopeId = options?.scopeId;
    if (scopeId) {
      const ownedScopeId = this._scopeIdsByOwnerKey.get(
        this._toOwnerKey(scopeId, blockId),
      );
      if (ownedScopeId) {
        return this._getScope(ownedScopeId);
      }
      return this._findRegisteredScopeForBlock(scopeId, blockId);
    }

    let match: DocumentScope | null = null;
    for (const entry of this._scopes.values()) {
      if (entry.scope.ownerBlockId !== blockId) {
        continue;
      }
      if (match) {
        return null;
      }
      match = cloneScope(entry.scope);
    }
    return match;
  }

  listScopes(): readonly DocumentScope[] {
    return Array.from(this._scopes.values(), (entry) => cloneScope(entry.scope));
  }

  getAwareness(scopeId?: string): Awareness | null {
    const scope = this._getScopeEntry(scopeId ?? this.rootScope.id);
    return scope?.awareness ?? null;
  }

  observe(scopeId: string, callback: ScopeListener): Unsubscribe {
    const listeners = this._listenersByScope.get(scopeId) ?? new Set<ScopeListener>();
    listeners.add(callback);
    this._listenersByScope.set(scopeId, listeners);
    return () => {
      listeners.delete(callback);
      if (listeners.size === 0) {
        this._listenersByScope.delete(scopeId);
      }
    };
  }

  observeAll(callback: ScopeListener): Unsubscribe {
    this._allListeners.add(callback);
    return () => {
      this._allListeners.delete(callback);
    };
  }

  createSubdocument(
    blockId: string,
    options?: CreateSubdocumentOptions,
  ): DocumentScope | null {
    const scopeId = options?.scopeId ?? this.rootScope.id;
    const parentEntry = this._getScopeEntry(scopeId);
    if (!parentEntry || !isYjsCRDTDocument(parentEntry.scope.doc)) {
      return null;
    }

    const blockMap = parentEntry.scope.doc.penDocument.blocks.get(blockId);
    if (!blockMap) {
      return null;
    }

    const existing = blockMap.get(SUBDOCUMENT);
    if (isYjsDoc(existing)) {
      const existingScope = this.getScopeByGuid(getDocumentGuid(existing));
      if (existingScope) {
        return existingScope;
      }
      return this._registerScope(
        wrapYjsDocument(this.adapter, existing),
        {
          parentId: parentEntry.scope.id,
          ownerBlockId: blockId,
        },
      );
    }

    const subdoc = createYjsSubdocument(parentEntry.scope.doc.ydoc, options);
    const subdocGuid = getDocumentGuid(subdoc);

    parentEntry.scope.doc.ydoc.transact(() => {
      blockMap.set(SUBDOCUMENT, subdoc);
      const props = blockMap.get("props");
      if (isYjsMap(props)) {
        props.set("subdocumentGuid", subdocGuid);
      }
    }, "system");

    return (
      this.getScopeByGuid(subdocGuid) ??
      this._registerScope(wrapYjsDocument(this.adapter, subdoc), {
        parentId: parentEntry.scope.id,
        ownerBlockId: blockId,
      })
    );
  }

  loadSubdocument(scopeId: string): void {
    const scope = this._getScopeEntry(scopeId);
    if (!scope || !isYjsCRDTDocument(scope.scope.doc)) {
      return;
    }
    scope.scope.doc.ydoc.load();
  }

  attachEditor(): Unsubscribe {
    this._attachedEditors += 1;
    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;
      this._attachedEditors = Math.max(0, this._attachedEditors - 1);
      if (this._destroyWhenIdle && this._attachedEditors === 0) {
        this.destroy();
      }
    };
  }

  destroy(): void {
    if (this._destroyed) {
      return;
    }
    this._destroyed = true;

    for (const entry of this._scopes.values()) {
      entry.observerUnsub();
      entry.awareness?.destroy();
      if (entry.subdocsHandler && isYjsCRDTDocument(entry.scope.doc)) {
        entry.scope.doc.ydoc.off("subdocs", entry.subdocsHandler);
      }
      if (this._ownsDocuments && isYjsCRDTDocument(entry.scope.doc)) {
        entry.scope.doc.ydoc.destroy();
      }
    }

    this._scopes.clear();
    this._guidToScopeId.clear();
    this._scopeIdsByOwnerKey.clear();
    this._listenersByScope.clear();
    this._allListeners.clear();
  }

  private _registerScope(
    doc: CRDTDocument,
    location: { parentId: string | null; ownerBlockId: string | null },
  ): DocumentScope {
    const existingId = this._findExistingScopeId(doc);
    if (existingId) {
      const existing = this._scopes.get(existingId);
      if (existing) {
        this._removeOwnerIndex(existing.scope);
        existing.scope.parentId = location.parentId;
        existing.scope.ownerBlockId = location.ownerBlockId;
        this._indexOwnerScope(existing.scope);
        return cloneScope(existing.scope);
      }
    }

    const scopeId = toScopeId(doc);
    const scope: DocumentScope = {
      id: scopeId,
      guid: scopeId,
      kind: location.parentId ? "subdocument" : "root",
      parentId: location.parentId,
      ownerBlockId: location.ownerBlockId,
      doc,
    };

    const entry: ScopeEntry = {
      scope,
      awareness: this.adapter.createAwareness?.(doc) ?? null,
      observerUnsub: () => {},
      subdocsHandler: null,
    };

    entry.observerUnsub = this.adapter.observe(doc, (event) => {
      this._syncOwnedSubdocumentScopes(entry, event.affectedBlocks);
      this._emit(scope, event);
    });

    this._scopes.set(scopeId, entry);
    this._guidToScopeId.set(scope.guid, scope.id);
    this._indexOwnerScope(scope);

    if (isYjsCRDTDocument(doc)) {
      this._attachSubdocumentDiscovery(entry, doc);
      this._syncOwnedSubdocumentScopes(entry);
    }

    return cloneScope(scope);
  }

  private _attachSubdocumentDiscovery(
    entry: ScopeEntry,
    doc: YjsCRDTDocument,
  ): void {
    const registerSubdoc = (subdoc: YjsDoc) => {
      const ownerBlockId = this._resolveOwnerBlockId(doc, subdoc);
      if (!ownerBlockId) {
        return;
      }
      this._registerScope(wrapYjsDocument(this.adapter, subdoc), {
        parentId: entry.scope.id,
        ownerBlockId,
      });
    };

    const existingSubdocs = Array.from(doc.ydoc.subdocs);
    for (const subdoc of existingSubdocs) {
      registerSubdoc(subdoc);
    }

    const handler = (event: {
      added: Set<YjsDoc>;
      loaded: Set<YjsDoc>;
      removed: Set<YjsDoc>;
    }) => {
      for (const subdoc of event.added) {
        registerSubdoc(subdoc);
      }
      for (const subdoc of event.loaded) {
        registerSubdoc(subdoc);
      }
      for (const subdoc of event.removed) {
        this._removeScopeByGuid(getDocumentGuid(subdoc));
      }
    };

    doc.ydoc.on("subdocs", handler);
    entry.subdocsHandler = handler;
  }

  private _resolveOwnerBlockId(
    doc: YjsCRDTDocument,
    subdoc: YjsDoc,
  ): string | null {
    for (const [blockId, blockMap] of doc.penDocument.blocks.entries()) {
      if (blockMap.get(SUBDOCUMENT) === subdoc) {
        return blockId;
      }
    }
    return null;
  }

  private _removeScopeByGuid(guid: string): void {
    const scopeId = this._guidToScopeId.get(guid);
    if (!scopeId || scopeId === this.rootScope.id) {
      return;
    }
    const entry = this._scopes.get(scopeId);
    if (!entry) {
      return;
    }

    entry.observerUnsub();
    entry.awareness?.destroy();
    if (entry.subdocsHandler && isYjsCRDTDocument(entry.scope.doc)) {
      entry.scope.doc.ydoc.off("subdocs", entry.subdocsHandler);
    }
    this._removeOwnerIndex(entry.scope);
    this._scopes.delete(scopeId);
    this._guidToScopeId.delete(guid);
    this._listenersByScope.delete(scopeId);
  }

  private _emit(scope: DocumentScope, event: CRDTEvent): void {
    const scopedEvent: CRDTEvent = {
      ...event,
      scope: {
        id: scope.id,
        guid: scope.guid,
        kind: scope.kind,
        parentId: scope.parentId,
        ownerBlockId: scope.ownerBlockId,
      },
    };

    const scopeListeners = this._listenersByScope.get(scope.id);
    if (scopeListeners) {
      for (const listener of scopeListeners) {
        listener(scopedEvent);
      }
    }

    for (const listener of this._allListeners) {
      listener(scopedEvent);
    }
  }

  private _findExistingScopeId(doc: CRDTDocument): string | null {
    for (const [scopeId, entry] of this._scopes.entries()) {
      if (entry.scope.doc === doc) {
        return scopeId;
      }
      if (
        isYjsCRDTDocument(entry.scope.doc) &&
        isYjsCRDTDocument(doc) &&
        entry.scope.doc.ydoc === doc.ydoc
      ) {
        return scopeId;
      }
    }
    return null;
  }

  private _findRegisteredScopeForBlock(
    scopeId: string,
    blockId: string,
  ): DocumentScope | null {
    const parentEntry = this._getScopeEntry(scopeId);
    if (!parentEntry || !isYjsCRDTDocument(parentEntry.scope.doc)) {
      return null;
    }
    const subdoc = parentEntry.scope.doc.penDocument.blocks.get(blockId)?.get(
      SUBDOCUMENT,
    );
    if (!isYjsDoc(subdoc)) {
      return null;
    }
    return this.getScopeByGuid(getDocumentGuid(subdoc));
  }

  private _syncOwnedSubdocumentScopes(
    entry: ScopeEntry,
    blockIds?: Iterable<string>,
  ): void {
    if (!isYjsCRDTDocument(entry.scope.doc)) {
      return;
    }

    const targetBlockIds =
      blockIds ?? entry.scope.doc.penDocument.blocks.keys();

    for (const blockId of targetBlockIds) {
      const blockMap = entry.scope.doc.penDocument.blocks.get(blockId);
      const subdoc = blockMap?.get(SUBDOCUMENT);
      if (!isYjsDoc(subdoc)) {
        continue;
      }
      this._registerScope(wrapYjsDocument(this.adapter, subdoc), {
        parentId: entry.scope.id,
        ownerBlockId: blockId,
      });
    }
  }

  private _indexOwnerScope(scope: DocumentScope): void {
    if (!scope.parentId || !scope.ownerBlockId) {
      return;
    }
    this._scopeIdsByOwnerKey.set(
      this._toOwnerKey(scope.parentId, scope.ownerBlockId),
      scope.id,
    );
  }

  private _removeOwnerIndex(scope: DocumentScope): void {
    if (!scope.parentId || !scope.ownerBlockId) {
      return;
    }
    this._scopeIdsByOwnerKey.delete(
      this._toOwnerKey(scope.parentId, scope.ownerBlockId),
    );
  }

  private _toOwnerKey(scopeId: string, blockId: string): string {
    return `${scopeId}:${blockId}`;
  }

  private _getScope(scopeId: string): DocumentScope | null {
    const entry = this._getScopeEntry(scopeId);
    return entry ? cloneScope(entry.scope) : null;
  }

  private _getScopeEntry(scopeId: string): ScopeEntry | null {
    return this._scopes.get(scopeId) ?? null;
  }
}

export function createDocumentSession(
  options: CreateDocumentSessionOptions,
): DocumentSession {
  return new DocumentSessionImpl(options);
}
