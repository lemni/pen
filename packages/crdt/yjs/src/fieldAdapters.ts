import * as Y from "yjs";

export type YjsFieldObserver = () => void;
export type YjsFieldUnsubscribe = () => void;

export interface YTextFieldAdapter {
	read(): string;
	replace(value: string): void;
	observe(callback: YjsFieldObserver): YjsFieldUnsubscribe;
}

export interface CreateYTextFieldAdapterOptions {
	doc: Y.Doc;
	root: Y.Map<unknown>;
	key: string;
	normalize?: (value: string) => string;
	origin?: unknown;
}

export interface YArrayFieldAdapter<T extends object> {
	read(): T[];
	replace(value: readonly T[]): void;
	insert(item: T, index?: number): void;
	update(id: string, patch: Partial<T> | ((item: T) => T)): boolean;
	remove(id: string): boolean;
	observe(callback: YjsFieldObserver): YjsFieldUnsubscribe;
}

export interface CreateYArrayFieldAdapterOptions<T extends object> {
	doc: Y.Doc;
	root: Y.Map<unknown>;
	key: string;
	getId: (item: T) => string;
	normalizeItem?: (item: T) => T;
	fromYMap?: (item: Y.Map<unknown>) => T | undefined;
	toYMap?: (item: T) => Y.Map<unknown>;
	origin?: unknown;
}

export function createYTextFieldAdapter(
	options: CreateYTextFieldAdapterOptions,
): YTextFieldAdapter {
	const text = ensureYText(options.root, options.key);

	return {
		read() {
			return text.toString();
		},
		replace(value) {
			const normalized = options.normalize?.(value) ?? value;
			options.doc.transact(
				() => {
					text.delete(0, text.length);
					text.insert(0, normalized);
				},
				options.origin ?? `pen:y-text-field:${options.key}`,
			);
		},
		observe(callback) {
			text.observe(callback);
			return () => text.unobserve(callback);
		},
	};
}

export function createYArrayFieldAdapter<T extends object>(
	options: CreateYArrayFieldAdapterOptions<T>,
): YArrayFieldAdapter<T> {
	const array = ensureYArray<Y.Map<unknown>>(options.root, options.key);
	const readItem = options.fromYMap ?? defaultFromYMap<T>;
	const serializeItem = options.toYMap ?? defaultToYMap<T>;
	const writeItem = (item: T) =>
		serializeItem(normalizeArrayItem(item, options));

	return {
		read() {
			return array.toArray().flatMap((item) => {
				const value = readItem(item);
				return value ? [normalizeArrayItem(value, options)] : [];
			});
		},
		replace(value) {
			options.doc.transact(
				() => {
					array.delete(0, array.length);
					array.push(value.map((item) => writeItem(item)));
				},
				options.origin ?? `pen:y-array-field:${options.key}:replace`,
			);
		},
		insert(item, index = array.length) {
			options.doc.transact(
				() => {
					array.insert(Math.min(Math.max(index, 0), array.length), [
						writeItem(item),
					]);
				},
				options.origin ?? `pen:y-array-field:${options.key}:insert`,
			);
		},
		update(id, patch) {
			const match = findArrayItem(array, readItem, options.getId, id);
			if (!match) {
				return false;
			}

			const current = normalizeArrayItem(match.item, options);
			const next =
				typeof patch === "function"
					? patch(current)
					: ({ ...current, ...patch } as T);
			const normalized = normalizeArrayItem(next, options);
			options.doc.transact(
				() => {
					if (options.toYMap) {
						array.delete(match.index, 1);
						array.insert(match.index, [writeItem(normalized)]);
						return;
					}
					replaceYMapContents(match.yMap, normalized);
				},
				options.origin ?? `pen:y-array-field:${options.key}:update`,
			);
			return true;
		},
		remove(id) {
			const match = findArrayItem(array, readItem, options.getId, id);
			if (!match) {
				return false;
			}

			options.doc.transact(
				() => {
					array.delete(match.index, 1);
				},
				options.origin ?? `pen:y-array-field:${options.key}:remove`,
			);
			return true;
		},
		observe(callback) {
			array.observeDeep(callback);
			return () => array.unobserveDeep(callback);
		},
	};
}

function ensureYText(root: Y.Map<unknown>, key: string): Y.Text {
	const current = root.get(key);
	if (current instanceof Y.Text) {
		return current;
	}
	const next = new Y.Text();
	root.set(key, next);
	return next;
}

function ensureYArray<T>(root: Y.Map<unknown>, key: string): Y.Array<T> {
	const current = root.get(key);
	if (current instanceof Y.Array) {
		return current as Y.Array<T>;
	}
	const next = new Y.Array<T>();
	root.set(key, next);
	return next;
}

function normalizeArrayItem<T extends object>(
	item: T,
	options: CreateYArrayFieldAdapterOptions<T>,
): T {
	return options.normalizeItem?.(item) ?? item;
}

function defaultToYMap<T extends object>(item: T): Y.Map<unknown> {
	const yMap = new Y.Map<unknown>();
	for (const [key, value] of Object.entries(item)) {
		yMap.set(key, value);
	}
	return yMap;
}

function defaultFromYMap<T extends object>(
	item: Y.Map<unknown>,
): T | undefined {
	return Object.fromEntries(item.entries()) as T;
}

function findArrayItem<T extends object>(
	array: Y.Array<Y.Map<unknown>>,
	readItem: (item: Y.Map<unknown>) => T | undefined,
	getId: (item: T) => string,
	id: string,
): { index: number; yMap: Y.Map<unknown>; item: T } | undefined {
	const values = array.toArray();
	for (let index = 0; index < values.length; index += 1) {
		const yMap = values[index]!;
		const item = readItem(yMap);
		if (item && getId(item) === id) {
			return { index, yMap, item };
		}
	}
	return undefined;
}

function replaceYMapContents<T extends object>(
	target: Y.Map<unknown>,
	source: T,
): void {
	for (const key of Array.from(target.keys())) {
		target.delete(key);
	}
	for (const [key, value] of Object.entries(source)) {
		target.set(key, value);
	}
}
