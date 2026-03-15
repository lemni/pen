import type { SchemaRegistry } from "@pen/types";
import type { FieldEditorTextLike } from "./crdt";

/**
 * Enforces InlineSchema.expand policy at every text insertion point.
 * See Spec Section 4.3.
 */
export function resolveMarksAtPosition(
  ytext: FieldEditorTextLike,
  offset: number,
  registry: SchemaRegistry,
): Record<string, unknown> | undefined {
  const deltas = ytext.toDelta();
  let currentOffset = 0;
  let activeAttributes: Record<string, unknown> | null = null;

  for (const delta of deltas) {
    const len = typeof delta.insert === "string" ? delta.insert.length : 1;

    if (offset >= currentOffset && offset <= currentOffset + len) {
      activeAttributes = delta.attributes ?? null;

      if (offset === currentOffset + len) {
        return filterByExpandPolicy(activeAttributes, "after", registry);
      }

      if (offset === currentOffset) {
        return filterByExpandPolicy(activeAttributes, "before", registry);
      }

      return activeAttributes ?? undefined;
    }

    currentOffset += len;
  }

  return undefined;
}

function filterByExpandPolicy(
  attributes: Record<string, unknown> | null,
  boundary: "before" | "after",
  registry: SchemaRegistry,
): Record<string, unknown> | undefined {
  if (!attributes) return undefined;

  const filtered: Record<string, unknown> = {};
  for (const [mark, value] of Object.entries(attributes)) {
    const schema = registry.resolveInline(mark);
    if (!schema) {
      filtered[mark] = value;
      continue;
    }
    const expand = schema.expand ?? "after";
    if (boundary === "after") {
      if (expand === "after" || expand === "both") {
        filtered[mark] = value;
      }
    } else {
      if (expand === "before" || expand === "both" || expand === "after") {
        filtered[mark] = value;
      }
    }
  }

  return Object.keys(filtered).length > 0 ? filtered : undefined;
}
