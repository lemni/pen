import type { InlineDecoration, SchemaRegistry } from "@pen/types";
import { sortDeltaAttributes } from "@pen/core";
import type { FieldEditorDelta, FieldEditorTextLike } from "./crdt";
import {
	applyInlineDecorationsToDeltas,
	INLINE_DECORATION_ATTRIBUTE_KEY,
} from "../utils/inlineDecorations";
import {
	areInlineAtomElementDataEqual,
	copyInlineAtomElementData,
	createInlineAtomElement,
	domPointToLogicalOffset,
	findLogicalDOMPoint,
	getLogicalNodeLength,
	isInlineAtomNode,
} from "./inlineAtomDom";

// ── Fast path: event-driven delta application ──────────────

export function applyDeltaToDOM(
	delta: readonly FieldEditorDelta[],
	element: HTMLElement,
	_registry: SchemaRegistry,
): boolean {
	let childIndex = 0;
	let textOffset = 0;

	for (const entry of delta) {
		if (entry.retain != null) {
			let remaining = entry.retain;
			while (remaining > 0 && childIndex < element.childNodes.length) {
				const span = element.childNodes[childIndex];
				const available = getLogicalNodeLength(span) - textOffset;

				if (remaining < available) {
					textOffset += remaining;
					remaining = 0;
				} else {
					remaining -= available;
					childIndex++;
					textOffset = 0;
				}
			}
			if (remaining > 0) return false;

			if (entry.attributes != null) {
				return false;
			}
		} else if (typeof entry.insert === "string") {
			const text = entry.insert;

			if (!entry.attributes) {
				const span = element.childNodes[childIndex];
				if (span && span.nodeType === Node.TEXT_NODE) {
					const existing = span.textContent ?? "";
					span.textContent =
						existing.slice(0, textOffset) +
						text +
						existing.slice(textOffset);
					textOffset += text.length;
				} else if (span && span.nodeType === Node.ELEMENT_NODE) {
					if (isInlineAtomNode(span)) {
						if (textOffset !== 0) return false;
						element.insertBefore(
							document.createTextNode(text),
							span,
						);
						childIndex++;
						textOffset = 0;
						continue;
					}
					const leaf = deepLeafText(span);
					if (!leaf) return false;
					const existing = leaf.textContent ?? "";
					leaf.textContent =
						existing.slice(0, textOffset) +
						text +
						existing.slice(textOffset);
					textOffset += text.length;
				} else {
					element.appendChild(document.createTextNode(text));
					childIndex = element.childNodes.length - 1;
					textOffset = text.length;
				}
			} else {
				if (textOffset === 0) {
					const node = createMarkedNode(
						text,
						entry.attributes,
						_registry,
					);
					const ref = element.childNodes[childIndex] ?? null;
					element.insertBefore(node, ref);
					childIndex++;
				} else {
					return false;
				}
			}
		} else if (entry.insert != null) {
			return false;
		} else if (entry.delete != null) {
			let remaining = entry.delete;
			while (remaining > 0 && childIndex < element.childNodes.length) {
				const span = element.childNodes[childIndex];
				if (isInlineAtomNode(span)) {
					if (textOffset !== 0) return false;
					element.removeChild(span);
					remaining -= 1;
					continue;
				}
				const leaf =
					span.nodeType === Node.TEXT_NODE
						? span
						: deepLeafText(span);
				if (!leaf) return false;
				const existing = leaf.textContent ?? "";
				const available = getLogicalNodeLength(span) - textOffset;

				if (remaining < available) {
					leaf.textContent =
						existing.slice(0, textOffset) +
						existing.slice(textOffset + remaining);
					remaining = 0;
				} else {
					if (textOffset === 0) {
						element.removeChild(span);
						remaining -= existing.length;
					} else {
						leaf.textContent = existing.slice(0, textOffset);
						remaining -= available;
						childIndex++;
						textOffset = 0;
					}
				}
			}
		}
	}
	return true;
}

function deepLeafText(node: Node): Text | null {
	if (node.nodeType === Node.TEXT_NODE) return node as Text;
	for (let i = 0; i < node.childNodes.length; i++) {
		const found = deepLeafText(node.childNodes[i]);
		if (found) return found;
	}
	return null;
}

// ── Full reconciliation fallback ───────────────────────────

export function fullReconcileToDOM(
	ytext: FieldEditorTextLike,
	element: HTMLElement,
	registry: SchemaRegistry,
	options?: {
		preserveSelection?: boolean;
		inlineDecorations?: readonly InlineDecoration[];
	},
): void {
	const textDeltas = ytext.toDelta().filter(
		(
			delta,
		): delta is FieldEditorDelta & {
			insert: string | Record<string, unknown>;
		} => delta.insert != null,
	);
	const renderedDeltas =
		options?.inlineDecorations && options.inlineDecorations.length > 0
			? applyInlineDecorationsToDeltas(
					textDeltas,
					options.inlineDecorations,
				)
			: textDeltas;
	fullReconcileDeltasToDOM(renderedDeltas, element, registry, options);
}

export function fullReconcileDeltasToDOM(
	deltas: FieldEditorDelta[],
	element: HTMLElement,
	registry: SchemaRegistry,
	options?: { preserveSelection?: boolean },
): void {
	const orderedDeltas = deltas.map((d) => {
		if (!d.attributes || Object.keys(d.attributes).length < 2) return d;
		return {
			...d,
			attributes: sortDeltaAttributes(d.attributes, registry),
		};
	});

	const preserveSelection = options?.preserveSelection ?? true;
	const savedSel = preserveSelection ? saveSelection(element) : null;

	const fragment = document.createDocumentFragment();
	for (const delta of orderedDeltas) {
		if (delta.insert == null) continue;
		let node: Node =
			typeof delta.insert === "string"
				? document.createTextNode(delta.insert)
				: createInlineAtomElement(delta.insert, registry);
		if (delta.attributes) {
			node = wrapWithMarks(node, delta.attributes, registry);
		}
		fragment.appendChild(node);
	}

	patchDOM(element, fragment);
	if (savedSel) {
		restoreSelection(element, savedSel);
	}
}

// ── Mark wrapping ──────────────────────────────────────────

function wrapWithMarks(
	node: Node,
	attributes: Record<string, unknown>,
	registry: SchemaRegistry,
): Node {
	let wrapped = node;
	const decorationAttributes = isDecorationAttributesValue(
		attributes[INLINE_DECORATION_ATTRIBUTE_KEY],
	)
		? attributes[INLINE_DECORATION_ATTRIBUTE_KEY]
		: null;

	const entries = Object.entries(attributes)
		.filter(([key]) => key !== INLINE_DECORATION_ATTRIBUTE_KEY)
		.filter(([_, v]) => v !== null && v !== false)
		.sort(([a], [b]) => {
			const schemaA = registry.resolveInline(a);
			const schemaB = registry.resolveInline(b);
			return (schemaA?.priority ?? 0) - (schemaB?.priority ?? 0);
		});

	for (const [markType, markProps] of entries) {
		const el = createMarkElement(markType, markProps);
		el.appendChild(wrapped);
		wrapped = el;
	}

	if (decorationAttributes) {
		const el = createMarkElement(
			INLINE_DECORATION_ATTRIBUTE_KEY,
			decorationAttributes,
		);
		el.appendChild(wrapped);
		wrapped = el;
	}

	return wrapped;
}

function createMarkedNode(
	text: string,
	attributes: Record<string, unknown>,
	registry: SchemaRegistry,
): Node {
	let node: Node = document.createTextNode(text);
	return wrapWithMarks(node, attributes, registry);
}

function createMarkElement(markType: string, props: unknown): HTMLElement {
	switch (markType) {
		case INLINE_DECORATION_ATTRIBUTE_KEY: {
			const span = document.createElement("span");
			applyElementAttributes(span, props);
			return span;
		}
		case "bold":
			return document.createElement("strong");
		case "italic":
			return document.createElement("em");
		case "underline":
			return document.createElement("u");
		case "strikethrough":
			return document.createElement("s");
		case "code":
			return document.createElement("code");
		case "link": {
			const a = document.createElement("a");
			if (typeof props === "object" && props !== null) {
				const p = props as Record<string, unknown>;
				if (p.href) a.href = p.href as string;
				if (p.title) a.title = p.title as string;
			}
			return a;
		}
		case "highlight": {
			const mark = document.createElement("mark");
			if (typeof props === "object" && props !== null) {
				const p = props as Record<string, unknown>;
				if (p.color) mark.style.backgroundColor = p.color as string;
			}
			return mark;
		}
		case "suggestion": {
			const span = document.createElement("span");
			span.dataset.markType = markType;

			if (typeof props === "object" && props !== null) {
				const p = props as Record<string, unknown>;
				const suggestionId =
					typeof p.id === "string" && p.id.length > 0 ? p.id : null;
				const suggestionAction =
					p.action === "delete" ? "delete" : "insert";

				if (suggestionId) {
					span.dataset.suggestionId = suggestionId;
				}

				span.dataset.suggestionAction = suggestionAction;
				span.classList.add(
					suggestionAction === "delete"
						? "pen-suggestion-delete"
						: "pen-suggestion-insert",
				);
			}

			return span;
		}
		default: {
			const span = document.createElement("span");
			span.dataset.markType = markType;
			return span;
		}
	}
}

function applyElementAttributes(element: HTMLElement, props: unknown): void {
	if (!isDecorationAttributesValue(props)) {
		return;
	}

	for (const [key, value] of Object.entries(props)) {
		if (value === null || value === false || value === undefined) {
			continue;
		}
		if (key === "class" && typeof value === "string") {
			element.className = value;
			continue;
		}
		if (key === "style" && typeof value === "string") {
			element.style.cssText = value;
			continue;
		}
		if (value === true) {
			element.setAttribute(key, "");
			continue;
		}
		element.setAttribute(key, String(value));
	}
}

function isDecorationAttributesValue(
	value: unknown,
): value is Record<string, string | number | boolean> {
	return typeof value === "object" && value !== null;
}

// ── DOM patching ───────────────────────────────────────────

function patchDOM(target: HTMLElement, source: DocumentFragment): void {
	const targetNodes = Array.from(target.childNodes);
	const sourceNodes = Array.from(source.childNodes);

	let ti = 0;
	let si = 0;

	while (si < sourceNodes.length) {
		const sourceNode = sourceNodes[si];

		if (ti < targetNodes.length) {
			const targetNode = targetNodes[ti];

			if (nodesStructurallyEqual(targetNode, sourceNode)) {
				if (
					isInlineAtomNode(targetNode) &&
					isInlineAtomNode(sourceNode)
				) {
					copyInlineAtomElementData(sourceNode, targetNode);
				}
				updateTextContent(targetNode, sourceNode);
				ti++;
				si++;
			} else {
				target.replaceChild(sourceNode, targetNode);
				ti++;
				si++;
			}
		} else {
			target.appendChild(sourceNode);
			si++;
		}
	}

	while (target.childNodes.length > sourceNodes.length) {
		target.removeChild(target.lastChild!);
	}
}

function nodesStructurallyEqual(a: Node, b: Node): boolean {
	if (a.nodeType !== b.nodeType) return false;
	if (a.nodeType === Node.TEXT_NODE) return true;
	if (a.nodeType === Node.ELEMENT_NODE) {
		const elA = a as Element;
		const elB = b as Element;
		if (isInlineAtomNode(elA) || isInlineAtomNode(elB)) {
			if (!isInlineAtomNode(elA) || !isInlineAtomNode(elB)) {
				return false;
			}
			if (!areInlineAtomElementDataEqual(elA, elB)) {
				return false;
			}
		}
		if (elA.tagName !== elB.tagName) return false;
		if (elA.attributes.length !== elB.attributes.length) return false;
		for (let i = 0; i < elA.attributes.length; i++) {
			const attr = elA.attributes[i];
			if (elB.getAttribute(attr.name) !== attr.value) return false;
		}
		if (elA.childNodes.length !== elB.childNodes.length) return false;
		for (let i = 0; i < elA.childNodes.length; i++) {
			if (!nodesStructurallyEqual(elA.childNodes[i], elB.childNodes[i]))
				return false;
		}
		return true;
	}
	return true;
}

function updateTextContent(target: Node, source: Node): void {
	if (
		target.nodeType === Node.TEXT_NODE &&
		source.nodeType === Node.TEXT_NODE
	) {
		if (target.textContent !== source.textContent) {
			target.textContent = source.textContent;
		}
		return;
	}
	if (
		target.nodeType === Node.ELEMENT_NODE &&
		source.nodeType === Node.ELEMENT_NODE
	) {
		for (let i = 0; i < target.childNodes.length; i++) {
			updateTextContent(target.childNodes[i], source.childNodes[i]);
		}
	}
}

// ── Selection save/restore ─────────────────────────────────

export interface SavedSelection {
	anchorOffset: number;
	focusOffset: number;
}

export function saveSelection(element: HTMLElement): SavedSelection | null {
	const sel = typeof window !== "undefined" ? window.getSelection() : null;
	if (!sel || sel.rangeCount === 0) return null;

	const anchorOffset = computeCharacterOffset(
		element,
		sel.anchorNode,
		sel.anchorOffset,
	);
	const focusOffset = computeCharacterOffset(
		element,
		sel.focusNode,
		sel.focusOffset,
	);

	return { anchorOffset, focusOffset };
}

export function restoreSelection(
	element: HTMLElement,
	saved: SavedSelection | null,
): void {
	if (!saved) return;
	try {
		const sel = window.getSelection();
		if (!sel) return;

		const anchor = findPositionInDOM(element, saved.anchorOffset);
		const focus = findPositionInDOM(element, saved.focusOffset);
		if (!anchor || !focus) return;

		sel.setBaseAndExtent(
			anchor.node,
			anchor.offset,
			focus.node,
			focus.offset,
		);
	} catch {
		// Selection restoration can fail if DOM structure changed
	}
}

function computeCharacterOffset(
	root: HTMLElement,
	node: Node | null,
	offset: number,
): number {
	if (!node) return 0;
	return domPointToLogicalOffset(root, node, offset);
}

function findPositionInDOM(
	root: HTMLElement,
	charOffset: number,
): { node: Node; offset: number } | null {
	return findLogicalDOMPoint(root, charOffset);
}
