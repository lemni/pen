import * as Y from "yjs";
import {
	encodeYjsStateVector,
	encodeYjsStateVectorBase64,
	yjsAdapter,
	wrapYjsDocument,
} from "@pen/crdt-yjs";
import type { CRDTDocument, PenDocument } from "@pen/types";
import { populateYDoc } from "./createTestDocument";
import { resetTestIdCounter } from "./helpers";
import type {
	DeterministicYDocFixture,
	DeterministicYDocFixtureOptions,
	NormalizedYDocSnapshot,
	NormalizedYjsValue,
	YjsRootExpectation,
} from "./types";

const DEFAULT_CLIENT_ID = 1;
const DEFAULT_FIXTURE_BLOCKS = [
	{
		id: "fixture-title",
		type: "heading",
		props: { level: 2 },
		content: "Deterministic fixture",
	},
	{
		id: "fixture-body",
		type: "paragraph",
		content: "Stable body text",
	},
];

export const DEFAULT_PEN_ROOTS = [
	{ name: "blockOrder", type: "array" },
	{ name: "blocks", type: "map" },
	{ name: "apps", type: "map" },
	{ name: "metadata", type: "map" },
] satisfies YjsRootExpectation[];

export class PenFixtureError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PenFixtureError";
	}
}

export function createDeterministicYDocFixture(
	options: DeterministicYDocFixtureOptions = {},
): DeterministicYDocFixture {
	resetTestIdCounter();
	const ydoc = new Y.Doc({ gc: false });
	setDeterministicClientId(ydoc, options.clientId ?? DEFAULT_CLIENT_ID);
	const blocks = options.blocks ?? DEFAULT_FIXTURE_BLOCKS;
	populateYDoc(ydoc, blocks);
	options.mutate?.(ydoc);

	const roots = options.roots ?? DEFAULT_PEN_ROOTS;
	assertDocumentRoots(ydoc, roots);

	const adapter = yjsAdapter();
	const crdtDoc = wrapYjsDocument(adapter, ydoc);

	return {
		ydoc,
		doc: crdtDoc.penDocument,
		crdtDoc,
		update: Y.encodeStateAsUpdate(ydoc),
		updateBase64: encodeFixtureUpdate(ydoc),
		stateVector: encodeYjsStateVector(ydoc),
		stateVectorBase64: encodeYjsStateVectorBase64(ydoc),
		snapshot: normalizeDocumentForSnapshot(ydoc, roots),
	};
}

export function encodeFixtureUpdate(ydoc: Y.Doc): string {
	return encodeUint8ArrayToBase64(Y.encodeStateAsUpdate(ydoc));
}

export function normalizeDocumentForSnapshot(
	ydoc: Y.Doc,
	roots: readonly YjsRootExpectation[] = DEFAULT_PEN_ROOTS,
): NormalizedYDocSnapshot {
	const normalizedRoots: Record<string, NormalizedYjsValue> = {};

	for (const root of roots) {
		const value = readRoot(ydoc, root);
		if (value === undefined) {
			continue;
		}
		normalizedRoots[root.name] = normalizeYjsValue(value);
	}

	return { roots: normalizedRoots };
}

export function assertDocumentRoots(
	ydoc: Y.Doc,
	roots: readonly YjsRootExpectation[] = DEFAULT_PEN_ROOTS,
): void {
	const failures = roots.flatMap((root) => {
		const value = readRoot(ydoc, root);
		if (value === undefined) {
			return root.optional ? [] : [`missing root "${root.name}"`];
		}
		if (root.type && !isExpectedRootType(value, root.type)) {
			return [`root "${root.name}" must be ${root.type}`];
		}
		return [];
	});

	if (failures.length > 0) {
		throw new PenFixtureError(
			`Invalid Yjs fixture roots: ${failures.join(", ")}`,
		);
	}
}

function setDeterministicClientId(ydoc: Y.Doc, clientId: number): void {
	(ydoc as unknown as { clientID: number }).clientID = clientId;
}

function readRoot(
	ydoc: Y.Doc,
	root: YjsRootExpectation,
): Y.AbstractType<unknown> | undefined {
	return (
		ydoc as unknown as { share: Map<string, Y.AbstractType<unknown>> }
	).share.get(root.name);
}

function isExpectedRootType(
	value: Y.AbstractType<unknown>,
	type: YjsRootExpectation["type"],
): boolean {
	if (type === "array") {
		return value instanceof Y.Array;
	}
	if (type === "text") {
		return value instanceof Y.Text;
	}
	return value instanceof Y.Map;
}

function normalizeYjsValue(value: unknown): NormalizedYjsValue {
	if (value instanceof Y.Map) {
		return Object.fromEntries(
			Array.from(value.entries())
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, normalizeYjsValue(child)]),
		);
	}

	if (value instanceof Y.Array) {
		return value.toArray().map((child) => normalizeYjsValue(child));
	}

	if (value instanceof Y.Text) {
		return value.toString();
	}

	if (value === undefined || value === null) {
		return null;
	}

	if (
		typeof value === "string" ||
		typeof value === "number" ||
		typeof value === "boolean"
	) {
		return value;
	}

	if (Array.isArray(value)) {
		return value.map((child) => normalizeYjsValue(child));
	}

	if (typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value as Record<string, unknown>)
				.sort(([left], [right]) => left.localeCompare(right))
				.map(([key, child]) => [key, normalizeYjsValue(child)]),
		);
	}

	return String(value);
}

function encodeUint8ArrayToBase64(value: Uint8Array): string {
	const buffer = (globalThis as Base64Globals).Buffer;
	if (buffer) {
		return buffer.from(value).toString("base64");
	}

	const btoa = (globalThis as Base64Globals).btoa;
	if (!btoa) {
		throw new PenFixtureError(
			"No base64 encoder is available in this runtime.",
		);
	}

	let binary = "";
	for (const byte of value) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

type Base64Globals = typeof globalThis & {
	Buffer?: {
		from(value: Uint8Array): { toString(encoding: "base64"): string };
	};
	btoa?: (value: string) => string;
};

export type { CRDTDocument, PenDocument };
