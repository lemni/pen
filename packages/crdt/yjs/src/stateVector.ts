import * as Y from "yjs";

type Base64Buffer = {
	toString(encoding: "base64"): string;
};

type BufferConstructorLike = {
	from(value: Uint8Array): Base64Buffer;
	from(value: string, encoding: "base64"): Uint8Array;
};

type Base64Globals = typeof globalThis & {
	Buffer?: BufferConstructorLike;
	atob?: (value: string) => string;
	btoa?: (value: string) => string;
};

export interface YjsStateVectorMissingClient {
	clientId: number;
	currentClock: number;
	requiredClock: number;
}

export interface YjsStateVectorComparison {
	satisfied: boolean;
	missingClients: YjsStateVectorMissingClient[];
	error?: string;
}

export function encodeYjsStateVector(doc: Y.Doc): Uint8Array {
	return Y.encodeStateVector(doc);
}

export function encodeYjsStateVectorBase64(doc: Y.Doc): string {
	return encodeUint8ArrayToBase64(encodeYjsStateVector(doc));
}

export function decodeYjsStateVectorBase64(value: string): Uint8Array {
	return decodeBase64ToUint8Array(value);
}

export function isYjsStateVectorSatisfied(
	currentStateVector: Uint8Array,
	requiredStateVector?: Uint8Array,
): boolean {
	return compareYjsStateVectors(currentStateVector, requiredStateVector)
		.satisfied;
}

export function isYjsStateVectorBase64Satisfied(
	currentStateVector: string,
	requiredStateVector?: string,
): boolean {
	return compareYjsStateVectorBase64(currentStateVector, requiredStateVector)
		.satisfied;
}

export function compareYjsStateVectorBase64(
	currentStateVector: string,
	requiredStateVector?: string,
): YjsStateVectorComparison {
	try {
		return compareYjsStateVectors(
			decodeYjsStateVectorBase64(currentStateVector),
			requiredStateVector
				? decodeYjsStateVectorBase64(requiredStateVector)
				: undefined,
		);
	} catch (error) {
		return invalidStateVectorComparison(error);
	}
}

export function compareYjsStateVectors(
	currentStateVector: Uint8Array,
	requiredStateVector?: Uint8Array,
): YjsStateVectorComparison {
	if (!requiredStateVector) {
		return { satisfied: true, missingClients: [] };
	}

	try {
		const current = Y.decodeStateVector(currentStateVector);
		const required = Y.decodeStateVector(requiredStateVector);
		const missingClients: YjsStateVectorMissingClient[] = [];

		for (const [clientId, requiredClock] of required.entries()) {
			const currentClock = current.get(clientId) ?? 0;
			if (currentClock < requiredClock) {
				missingClients.push({ clientId, currentClock, requiredClock });
			}
		}

		return {
			satisfied: missingClients.length === 0,
			missingClients,
		};
	} catch (error) {
		return invalidStateVectorComparison(error);
	}
}

function invalidStateVectorComparison(
	error: unknown,
): YjsStateVectorComparison {
	return {
		satisfied: false,
		missingClients: [],
		error:
			error instanceof Error ? error.message : "Invalid Yjs state vector",
	};
}

function encodeUint8ArrayToBase64(value: Uint8Array): string {
	const buffer = getBuffer();
	if (buffer) {
		return buffer.from(value).toString("base64");
	}

	const btoa = getBase64Global("btoa");
	let binary = "";
	for (const byte of value) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function decodeBase64ToUint8Array(value: string): Uint8Array {
	const buffer = getBuffer();
	if (buffer) {
		return new Uint8Array(buffer.from(value, "base64"));
	}

	const atob = getBase64Global("atob");
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

function getBuffer(): BufferConstructorLike | undefined {
	return (globalThis as Base64Globals).Buffer;
}

function getBase64Global(name: "atob" | "btoa"): (value: string) => string {
	const fn = (globalThis as Base64Globals)[name];
	if (!fn) {
		throw new Error(
			`globalThis.${name} is required to encode Yjs state vectors as base64`,
		);
	}
	return fn;
}
