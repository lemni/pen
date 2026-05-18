import type { SchemaRegistry } from "@pen/types";
import { DATA_ATTRS } from "../utils/dataAttributes";

export const INLINE_ATOM_REPLACEMENT_TEXT = "\uFFFC";

interface InlineAtomInsert {
	type: string;
	props: Record<string, unknown>;
}

export interface InlineAtomElementData extends InlineAtomInsert {
	text: string;
}

const inlineAtomElementData = new WeakMap<HTMLElement, InlineAtomElementData>();

export function resolveInlineAtomInsert(
	insert: unknown,
): InlineAtomInsert | null {
	if (!insert || typeof insert !== "object") {
		return null;
	}

	const record = insert as Record<string, unknown>;
	const type = typeof record.type === "string" ? record.type : "";
	if (!type) {
		return null;
	}

	if (record.props && typeof record.props === "object") {
		return {
			type,
			props: record.props as Record<string, unknown>,
		};
	}

	const props: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (key !== "type") {
			props[key] = value;
		}
	}

	return { type, props };
}

export function createInlineAtomElement(
	insert: unknown,
	registry: SchemaRegistry,
): HTMLElement {
	const atom = resolveInlineAtomInsert(insert);
	const element = document.createElement("span");
	element.setAttribute(DATA_ATTRS.inlineAtom, "");
	element.contentEditable = "false";

	if (!atom) {
		element.textContent = INLINE_ATOM_REPLACEMENT_TEXT;
		return element;
	}

	element.setAttribute(DATA_ATTRS.inlineAtomType, atom.type);
	const text = getInlineAtomText(atom, registry);
	element.setAttribute("aria-label", text);
	element.textContent = text;
	inlineAtomElementData.set(element, {
		...atom,
		text,
	});
	return element;
}

export function getInlineAtomElementData(
	element: Element,
): InlineAtomElementData | null {
	return element instanceof HTMLElement
		? (inlineAtomElementData.get(element) ?? null)
		: null;
}

export function copyInlineAtomElementData(
	source: Element,
	target: Element,
): void {
	if (!(target instanceof HTMLElement)) {
		return;
	}

	const data = getInlineAtomElementData(source);
	if (!data) {
		return;
	}

	inlineAtomElementData.set(target, {
		type: data.type,
		props: { ...data.props },
		text: data.text,
	});
}

export function areInlineAtomElementDataEqual(
	left: Element,
	right: Element,
): boolean {
	const leftData = getInlineAtomElementData(left);
	const rightData = getInlineAtomElementData(right);
	if (!leftData || !rightData) {
		return leftData === rightData;
	}

	return (
		leftData.type === rightData.type &&
		leftData.text === rightData.text &&
		shallowEqualRecords(leftData.props, rightData.props)
	);
}

export function isInlineAtomNode(node: Node | null): node is HTMLElement {
	return (
		node instanceof HTMLElement && node.hasAttribute(DATA_ATTRS.inlineAtom)
	);
}

function shallowEqualRecords(
	left: Record<string, unknown>,
	right: Record<string, unknown>,
): boolean {
	if (left === right) {
		return true;
	}

	const leftKeys = Object.keys(left);
	const rightKeys = Object.keys(right);
	if (leftKeys.length !== rightKeys.length) {
		return false;
	}

	return leftKeys.every((key) => Object.is(left[key], right[key]));
}

export function getLogicalNodeLength(node: Node): number {
	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent?.length ?? 0;
	}

	if (isInlineAtomNode(node)) {
		return 1;
	}

	let length = 0;
	for (const child of Array.from(node.childNodes)) {
		length += getLogicalNodeLength(child);
	}
	return length;
}

export function getLogicalTextContent(root: HTMLElement): string {
	let text = "";
	for (const child of Array.from(root.childNodes)) {
		text += getLogicalNodeText(child);
	}
	return text;
}

export function domPointToLogicalOffset(
	container: HTMLElement,
	targetNode: Node,
	targetOffset: number,
): number {
	const atomAncestor = findInlineAtomAncestor(targetNode, container);
	if (atomAncestor) {
		const atomOffset = getOffsetBeforeNode(container, atomAncestor);
		if (atomAncestor === targetNode) {
			return targetOffset <= 0 ? atomOffset : atomOffset + 1;
		}
		return atomOffset + 1;
	}

	const resolved = resolveLogicalOffset(container, targetNode, targetOffset);
	return resolved ?? getLogicalNodeLength(container);
}

export function findLogicalDOMPoint(
	container: HTMLElement,
	offset: number,
): { node: Node; offset: number } {
	return findLogicalDOMPointInElement(container, Math.max(0, offset));
}

function getInlineAtomText(
	atom: InlineAtomInsert,
	registry: SchemaRegistry,
): string {
	const schemaText = registry
		.resolveInline(atom.type)
		?.serialize.toMarkdown?.("", atom.props);
	if (schemaText) {
		return schemaText;
	}

	const label = atom.props.label;
	if (typeof label === "string" && label.length > 0) {
		return label;
	}

	const name = atom.props.name;
	if (typeof name === "string" && name.length > 0) {
		return name;
	}

	const id = atom.props.id;
	if (typeof id === "string" && id.length > 0) {
		return id;
	}

	return atom.type;
}

function getLogicalNodeText(node: Node): string {
	if (node.nodeType === Node.TEXT_NODE) {
		return node.textContent ?? "";
	}

	if (isInlineAtomNode(node)) {
		return INLINE_ATOM_REPLACEMENT_TEXT;
	}

	let text = "";
	for (const child of Array.from(node.childNodes)) {
		text += getLogicalNodeText(child);
	}
	return text;
}

function findInlineAtomAncestor(
	node: Node,
	container: HTMLElement,
): HTMLElement | null {
	let current: Node | null = node;
	while (current && current !== container) {
		if (isInlineAtomNode(current)) {
			return current;
		}
		current = current.parentNode;
	}
	return null;
}

function getOffsetBeforeNode(container: HTMLElement, target: Node): number {
	let offset = 0;
	let found = false;

	const visit = (node: Node) => {
		if (found) {
			return;
		}
		if (node === target) {
			found = true;
			return;
		}
		if (node !== container) {
			offset += getLogicalNodeLength(node);
			return;
		}
		for (const child of Array.from(node.childNodes)) {
			visit(child);
			if (found) {
				return;
			}
		}
	};

	visit(container);
	return offset;
}

function resolveLogicalOffset(
	current: Node,
	targetNode: Node,
	targetOffset: number,
): number | null {
	if (current === targetNode) {
		if (isInlineAtomNode(current)) {
			return targetOffset <= 0 ? 0 : 1;
		}

		if (current.nodeType === Node.TEXT_NODE) {
			return Math.min(targetOffset, current.textContent?.length ?? 0);
		}

		let offset = 0;
		const children = Array.from(current.childNodes);
		for (
			let index = 0;
			index < targetOffset && index < children.length;
			index += 1
		) {
			offset += getLogicalNodeLength(children[index]);
		}
		return offset;
	}

	if (current.nodeType === Node.TEXT_NODE || isInlineAtomNode(current)) {
		return null;
	}

	let offset = 0;
	for (const child of Array.from(current.childNodes)) {
		const childOffset = resolveLogicalOffset(
			child,
			targetNode,
			targetOffset,
		);
		if (childOffset !== null) {
			return offset + childOffset;
		}
		offset += getLogicalNodeLength(child);
	}

	return null;
}

function findLogicalDOMPointInElement(
	element: HTMLElement,
	offset: number,
): { node: Node; offset: number } {
	let remaining = offset;
	const children = Array.from(element.childNodes);

	for (let index = 0; index < children.length; index += 1) {
		const child = children[index];
		const length = getLogicalNodeLength(child);

		if (remaining === 0) {
			return { node: element, offset: index };
		}

		if (child.nodeType === Node.TEXT_NODE) {
			if (remaining <= length) {
				return { node: child, offset: remaining };
			}
			remaining -= length;
			continue;
		}

		if (isInlineAtomNode(child)) {
			if (remaining <= 1) {
				return { node: element, offset: index + 1 };
			}
			remaining -= 1;
			continue;
		}

		if (remaining <= length && child instanceof HTMLElement) {
			return findLogicalDOMPointInElement(child, remaining);
		}

		remaining -= length;
	}

	return { node: element, offset: children.length };
}
