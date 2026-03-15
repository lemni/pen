import type { Block } from "@pen/types";

export type Delta = {
	insert: string;
	attributes?: Record<string, unknown>;
};

export interface PenBlock {
	type?: string;
	props?: Record<string, unknown>;
	content?: string;
	deltas?: Delta[];
	isPartial?: boolean;
	children?: Block[];
}

export function encodePenBlocksForHtml(penBlocksJson: string): string {
	return bytesToBase64(new TextEncoder().encode(penBlocksJson));
}

export function decodePenBlocksFromHtml(encoded: string): PenBlock[] {
	return JSON.parse(new TextDecoder().decode(base64ToBytes(encoded))) as PenBlock[];
}

function bytesToBase64(bytes: Uint8Array): string {
	const binary = Array.from(bytes, (byte) => String.fromCodePoint(byte)).join("");
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	return Uint8Array.from(binary, (value) => value.codePointAt(0) ?? 0);
}
