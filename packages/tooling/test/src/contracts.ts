import * as Y from "yjs";
import { createHeadlessEditor } from "@pen/core";
import { yjsAdapter } from "@pen/crdt-yjs";
import {
	compareYjsStateVectors,
	encodeYjsStateVector,
	wrapYjsDocument,
} from "@pen/crdt-yjs";
import { exportEditorToJson, exportEditorToText } from "@pen/export-json";
import type { Editor, SchemaRegistry } from "@pen/types";
import type {
	DeterministicYDocFixture,
	DeterministicYDocFixtureOptions,
} from "./types";
import { createDeterministicYDocFixture, PenFixtureError } from "./fixtures";

export interface CRDTStateVectorContractResult {
	fixture: DeterministicYDocFixture;
	emptySatisfied: boolean;
	syncedSatisfied: boolean;
}

export interface CRDTStateVectorContractOptions extends DeterministicYDocFixtureOptions {
	createFixture?: () => DeterministicYDocFixture;
}

export interface HeadlessEditorContractResult {
	fixture: DeterministicYDocFixture;
	editor: Editor;
	blockCount: number;
}

export interface HeadlessEditorContractOptions extends DeterministicYDocFixtureOptions {
	createFixture?: () => DeterministicYDocFixture;
	schema?: SchemaRegistry;
}

export interface ExportContractResult extends HeadlessEditorContractResult {
	json: ReturnType<typeof exportEditorToJson>;
	text: string;
}

export interface ExportContractOptions extends HeadlessEditorContractOptions {
	allowEmptyText?: boolean;
}

export function runCRDTStateVectorContract(
	options: CRDTStateVectorContractOptions = {},
): CRDTStateVectorContractResult {
	const fixture = createContractFixture(options);
	const empty = new Y.Doc({ gc: false });
	const synced = new Y.Doc({ gc: false });
	Y.applyUpdate(synced, fixture.update);

	const requiredStateVector = encodeYjsStateVector(fixture.ydoc);
	const emptyComparison = compareYjsStateVectors(
		encodeYjsStateVector(empty),
		requiredStateVector,
	);
	const syncedComparison = compareYjsStateVectors(
		encodeYjsStateVector(synced),
		requiredStateVector,
	);

	if (emptyComparison.satisfied) {
		throw new PenFixtureError(
			"CRDT state-vector contract failed: empty document satisfied a populated fixture.",
		);
	}
	if (!syncedComparison.satisfied) {
		throw new PenFixtureError(
			"CRDT state-vector contract failed: synced document did not satisfy the fixture state vector.",
		);
	}

	return {
		fixture,
		emptySatisfied: emptyComparison.satisfied,
		syncedSatisfied: syncedComparison.satisfied,
	};
}

export function runHeadlessEditorContract(
	options: HeadlessEditorContractOptions = {},
): HeadlessEditorContractResult {
	const fixture = createContractFixture(options);
	const adapter = yjsAdapter();
	const editor = createHeadlessEditor({
		crdt: adapter,
		document: wrapYjsDocument(adapter, fixture.ydoc),
		schema: options.schema,
	});
	const blockCount = [...editor.documentState.allBlocks()].length;

	if (blockCount === 0) {
		throw new PenFixtureError(
			"Headless editor contract failed: fixture document has no blocks.",
		);
	}

	return { fixture, editor, blockCount };
}

export function runExportContract(
	options: ExportContractOptions = {},
): ExportContractResult {
	const headless = runHeadlessEditorContract(options);
	const json = exportEditorToJson(headless.editor);
	const text = exportEditorToText(headless.editor);

	if (json.blocks.length === 0) {
		throw new PenFixtureError(
			"Export contract failed: JSON export has no blocks.",
		);
	}
	if (!options.allowEmptyText && text.trim().length === 0) {
		throw new PenFixtureError(
			"Export contract failed: text export is empty.",
		);
	}

	return { ...headless, json, text };
}

function createContractFixture(
	options:
		| CRDTStateVectorContractOptions
		| HeadlessEditorContractOptions
		| ExportContractOptions,
): DeterministicYDocFixture {
	return (
		options.createFixture?.() ??
		createDeterministicYDocFixture({
			blocks: options.blocks,
			clientId: options.clientId,
			roots: options.roots,
			mutate: options.mutate,
		})
	);
}
