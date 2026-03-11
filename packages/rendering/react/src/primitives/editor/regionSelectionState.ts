import { createContext, useContext } from "react";
import { isDevelopmentEnvironment } from "../../utils/environment";

export type RegionSelectorSelectionMode = "block";
export type RegionSelectorActivation = "whenInactive";

export interface RegionSelectionRect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface RegionSelectorConfig {
	enabled: boolean;
	threshold: number;
	selectionMode: RegionSelectorSelectionMode;
	activation: RegionSelectorActivation;
	getRegionRect?: (() => DOMRect | null) | undefined;
}

export interface RegionSelectionSnapshot {
	config: RegionSelectorConfig | null;
	liveRect: RegionSelectionRect | null;
}

const EMPTY_REGION_SELECTION_SNAPSHOT: RegionSelectionSnapshot = {
	config: null,
	liveRect: null,
};

export class RegionSelectionStore {
	private _snapshot: RegionSelectionSnapshot =
		EMPTY_REGION_SELECTION_SNAPSHOT;
	private _listeners = new Set<() => void>();

	subscribe = (listener: () => void): (() => void) => {
		this._listeners.add(listener);
		return () => {
			this._listeners.delete(listener);
		};
	};

	getSnapshot = (): RegionSelectionSnapshot => {
		return this._snapshot;
	};

	setConfig(config: RegionSelectorConfig | null): void {
		if (configsEqual(this._snapshot.config, config)) {
			return;
		}
		this._snapshot = { ...this._snapshot, config };
		this._emit();
	}

	setLiveRect(liveRect: RegionSelectionRect | null): void {
		if (rectsEqual(this._snapshot.liveRect, liveRect)) {
			return;
		}
		this._snapshot = { ...this._snapshot, liveRect };
		this._emit();
	}

	clearLiveRect(): void {
		this.setLiveRect(null);
	}

	private _emit(): void {
		for (const listener of this._listeners) {
			listener();
		}
	}
}

export interface EditorRegionSelectionContextValue {
	rootElement: HTMLElement | null;
	setRootElement: (element: HTMLElement | null) => void;
	store: RegionSelectionStore;
}

export const EditorRegionSelectionContext =
	createContext<EditorRegionSelectionContextValue | null>(null);

export function useEditorRegionSelectionContext(): EditorRegionSelectionContextValue {
	const ctx = useContext(EditorRegionSelectionContext);
	if (!ctx) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: region selection primitives must be used within <Pen.Editor.Root>.",
			);
		}
		throw new Error("Missing Pen.Editor.Root region selection context");
	}
	return ctx;
}

function configsEqual(
	a: RegionSelectorConfig | null,
	b: RegionSelectorConfig | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.enabled === b.enabled &&
		a.threshold === b.threshold &&
		a.selectionMode === b.selectionMode &&
		a.activation === b.activation &&
		a.getRegionRect === b.getRegionRect
	);
}

function rectsEqual(
	a: RegionSelectionRect | null,
	b: RegionSelectionRect | null,
): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.left === b.left &&
		a.top === b.top &&
		a.width === b.width &&
		a.height === b.height
	);
}

export function resolveRegionRect(
	config: RegionSelectorConfig | null,
): DOMRect | null {
	return config?.getRegionRect?.() ?? null;
}

export function intersectRegionSelectionRect(
	rect: RegionSelectionRect,
	regionRect: DOMRect | null,
): RegionSelectionRect | null {
	if (!regionRect) {
		return rect;
	}

	const left = Math.max(rect.left, regionRect.left);
	const top = Math.max(rect.top, regionRect.top);
	const right = Math.min(rect.left + rect.width, regionRect.right);
	const bottom = Math.min(rect.top + rect.height, regionRect.bottom);

	if (right <= left || bottom <= top) {
		return null;
	}

	return {
		left,
		top,
		width: right - left,
		height: bottom - top,
	};
}
