import * as Y from "yjs";

export type YjsExtensionRootFieldType = "array" | "map" | "text" | "value";

export type YjsExtensionRootShape = Record<string, YjsExtensionRootFieldType>;

export interface YjsExtensionRootOptions {
	doc: Y.Doc;
	namespace: string;
	version: number;
	shape?: YjsExtensionRootShape;
	rootName?: string;
	origin?: unknown;
}

export interface YjsExtensionRoot {
	namespace: string;
	version: number;
	map: Y.Map<unknown>;
}

export interface YjsExtensionRootReadOptions {
	doc: Y.Doc;
	namespace: string;
	rootName?: string;
}

export class YjsExtensionRootError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "YjsExtensionRootError";
	}
}

const DEFAULT_ROOT_NAME = "apps";
const VERSION_KEY = "version";

export function ensureExtensionRoot(
	options: YjsExtensionRootOptions,
): YjsExtensionRoot {
	const apps = options.doc.getMap<Y.Map<unknown>>(
		options.rootName ?? DEFAULT_ROOT_NAME,
	);
	let root = apps.get(options.namespace);

	options.doc.transact(
		() => {
			if (root !== undefined && !(root instanceof Y.Map)) {
				throw new YjsExtensionRootError(
					`Extension root "${options.namespace}" exists but is not a Y.Map.`,
				);
			}

			if (!root) {
				root = new Y.Map<unknown>();
				apps.set(options.namespace, root);
			}

			const existingVersion = root.get(VERSION_KEY);
			if (
				existingVersion !== undefined &&
				existingVersion !== options.version
			) {
				throw new YjsExtensionRootError(
					`Extension root "${options.namespace}" version mismatch: expected ${options.version}, got ${String(existingVersion)}.`,
				);
			}

			root.set(VERSION_KEY, options.version);
			ensureExtensionRootShape(root, options.shape);
		},
		options.origin ?? `pen:extension-root:${options.namespace}`,
	);

	if (!root) {
		throw new YjsExtensionRootError(
			`Extension root "${options.namespace}" was not initialized.`,
		);
	}

	return {
		namespace: options.namespace,
		version: options.version,
		map: root,
	};
}

export function readExtensionRoot(
	options: YjsExtensionRootReadOptions,
): YjsExtensionRoot | undefined {
	const apps = options.doc.getMap<Y.Map<unknown>>(
		options.rootName ?? DEFAULT_ROOT_NAME,
	);
	const root = apps.get(options.namespace);
	if (!(root instanceof Y.Map)) {
		return undefined;
	}

	const version = root.get(VERSION_KEY);
	return {
		namespace: options.namespace,
		version: typeof version === "number" ? version : 0,
		map: root,
	};
}

function ensureExtensionRootShape(
	root: Y.Map<unknown>,
	shape: YjsExtensionRootShape | undefined,
): void {
	if (!shape) {
		return;
	}

	for (const [key, type] of Object.entries(shape)) {
		if (key === VERSION_KEY) {
			continue;
		}

		const current = root.get(key);
		if (current !== undefined) {
			if (!isExpectedFieldType(current, type)) {
				throw new YjsExtensionRootError(
					`Extension root field "${key}" exists but is not ${type}.`,
				);
			}
			continue;
		}

		root.set(key, createFieldValue(type));
	}
}

function isExpectedFieldType(
	value: unknown,
	type: YjsExtensionRootFieldType,
): boolean {
	if (type === "array") {
		return value instanceof Y.Array;
	}
	if (type === "map") {
		return value instanceof Y.Map;
	}
	if (type === "text") {
		return value instanceof Y.Text;
	}
	return !(value instanceof Y.AbstractType);
}

function createFieldValue(type: YjsExtensionRootFieldType): unknown {
	if (type === "array") {
		return new Y.Array<unknown>();
	}
	if (type === "map") {
		return new Y.Map<unknown>();
	}
	if (type === "text") {
		return new Y.Text();
	}
	return null;
}
