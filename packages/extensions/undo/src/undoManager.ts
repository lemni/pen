import type {
  CRDTUndoManager,
  UndoManager,
  OpOrigin,
  Unsubscribe,
} from "@pen/types";

export class UndoManagerImpl implements UndoManager {
  private readonly _crdtUndo: CRDTUndoManager;
  private readonly _trackedOrigins = new Map<OpOrigin, number>();
  private readonly _listeners = new Set<() => void>();
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  private _groupTimeout = 1000;
  _isHistoryOperation = false;

  constructor(crdtUndo: CRDTUndoManager, trackedOrigins?: Iterable<OpOrigin>) {
    this._crdtUndo = crdtUndo;
    for (const origin of trackedOrigins ?? []) {
      this._trackedOrigins.set(origin, 1);
    }
  }

  undo(): boolean {
    this._crdtUndo.stopCapturing();
    this._isHistoryOperation = true;
    try {
      return this._crdtUndo.undo();
    } finally {
      this._isHistoryOperation = false;
    }
  }

  redo(): boolean {
    this._crdtUndo.stopCapturing();
    this._isHistoryOperation = true;
    try {
      return this._crdtUndo.redo();
    } finally {
      this._isHistoryOperation = false;
    }
  }

  canUndo(): boolean {
    return this._crdtUndo.canUndo();
  }

  canRedo(): boolean {
    return this._crdtUndo.canRedo();
  }

  stopCapturing(): void {
    this._crdtUndo.stopCapturing();
    this._clearIdleTimer();
    this._notifyListeners();
  }

  setGroupTimeout(ms: number): void {
    this._groupTimeout = ms;
  }

  registerTrackedOrigins(origins: OpOrigin[]): Unsubscribe {
    const registeredOrigins = new Set<OpOrigin>();
    let didDispose = false;
    for (const origin of origins) {
      if (registeredOrigins.has(origin)) {
        continue;
      }
      registeredOrigins.add(origin);
      this._incrementTrackedOrigin(origin);
    }
    return () => {
      if (didDispose) {
        return;
      }
      didDispose = true;
      for (const origin of registeredOrigins) {
        this._decrementTrackedOrigin(origin);
      }
    };
  }

  hasTrackedOrigin(origin: OpOrigin): boolean {
    return (this._trackedOrigins.get(origin) ?? 0) > 0;
  }

  onStackChange(callback: () => void): Unsubscribe {
    this._listeners.add(callback);
    return () => {
      this._listeners.delete(callback);
    };
  }

  resetIdleTimer(): void {
    this._clearIdleTimer();
    this._idleTimer = setTimeout(() => {
      this._crdtUndo.stopCapturing();
      this._notifyListeners();
    }, this._groupTimeout);
  }

  _notifyListeners(): void {
    for (const cb of this._listeners) {
      try {
        cb();
      } catch {
        /* ignore */
      }
    }
  }

  destroy(): void {
    this._clearIdleTimer();
    this._listeners.clear();
  }

  private _incrementTrackedOrigin(origin: OpOrigin): void {
    const count = this._trackedOrigins.get(origin) ?? 0;
    if (count === 0) {
      this._crdtUndo.addTrackedOrigin(origin);
    }
    this._trackedOrigins.set(origin, count + 1);
  }

  private _decrementTrackedOrigin(origin: OpOrigin): void {
    const count = this._trackedOrigins.get(origin) ?? 0;
    if (count <= 1) {
      this._trackedOrigins.delete(origin);
      this._crdtUndo.removeTrackedOrigin(origin);
      return;
    }
    this._trackedOrigins.set(origin, count - 1);
  }

  private _clearIdleTimer(): void {
    if (this._idleTimer !== null) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }
}
