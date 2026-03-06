# Wave 10 — Layout System

**Milestone:** M2 · **Packages:** `@pen/layout`, `@pen/export-email` · **Depends on:** M1 (Waves 0-9)

---

## Goal

Ship the layout system: schema definitions for structural containers (section, row, column, stack, card), layout-aware block operations, drag-and-drop resizing, responsive breakpoints, LLM layout tools, and email export. After this wave, users can build multi-column layouts, drag blocks into columns, resize column widths, and export documents to email-safe HTML.

---

## File Structure

### `@pen/layout`

```
packages/extensions/layout/src/
├── extension.ts                  defineExtension — entry point
├── schemas/
│   ├── section.ts                section block schema (top-level container)
│   ├── row.ts                    row block schema (flex row)
│   ├── column.ts                 column block schema (flex column)
│   ├── stack.ts                  stack block schema (vertical stack)
│   ├── card.ts                   card block schema (bordered container)
│   └── index.ts                  Barrel — exports all layout schemas
├── operations/
│   ├── wrap.ts                   Wrap selected blocks in layout container
│   ├── unwrap.ts                 Unwrap layout container back to flat blocks
│   ├── resize.ts                 Resize columns (width redistribution)
│   ├── move.ts                   Move blocks between layout containers
│   ├── insert.ts                 Insert block into layout position
│   └── index.ts                  Barrel
├── normalization/
│   ├── layout-rules.ts           Layout-specific normalization (Rule 6)
│   └── constraint-checker.ts     Valid parent-child relationships
├── tools/
│   ├── wrap-in-columns.ts        LLM tool: wrap blocks in columns
│   ├── set-layout.ts             LLM tool: set layout properties
│   ├── remove-layout.ts          LLM tool: remove layout, flatten
│   └── index.ts                  Barrel
├── primitives/
│   ├── container.tsx             Pen.Layout.Container
│   ├── item.tsx                  Pen.Layout.Item
│   ├── resizer.tsx               Pen.Layout.Resizer
│   ├── drop-zone.tsx             Pen.Layout.DropZone
│   ├── breakpoint.tsx            Pen.Layout.Breakpoint
│   └── index.ts                  Barrel
├── hooks/
│   ├── use-layout.ts             useLayout() — current block's layout context
│   ├── use-resizer.ts            useResizer() — drag-resize state
│   ├── use-breakpoint.ts         useBreakpoint() — responsive breakpoint
│   └── index.ts                  Barrel
├── types.ts                      Layout-specific types
└── index.ts                      Package entry
```

### `@pen/export-email`

```
packages/exporters/email/src/
├── index.ts                      Package entry
├── exporter.ts                   Email HTML export entry point
├── inliner.ts                    CSS inlining engine (HTML-parser based)
├── html-parser.ts                Lightweight HTML tokenizer/serializer
├── table-converter.ts            Flexbox → table layout converter
├── sanitizer.ts                  Email-safe HTML sanitizer
├── templates/
│   ├── wrapper.ts                Outer HTML wrapper template
│   └── reset.ts                  Email CSS reset
└── types.ts                      Email export types
```

### Import DAG

```
@pen/layout:
  types.ts                ← (@pen/core)
  schemas/*               ← types.ts, (@pen/core)
  normalization/*         ← types.ts, schemas/*, (@pen/core)
  operations/*            ← types.ts, schemas/*, normalization/*, (@pen/core)
  tools/*                 ← operations/*, types.ts, (@pen/core)
  extension.ts            ← schemas/*, operations/*, normalization/*, tools/*, (@pen/core)
  hooks/*                 ← extension.ts, types.ts, (react)
  primitives/*            ← hooks/*, types.ts, (react)

@pen/export-email:
  types.ts                ← (@pen/core)
  inliner.ts              ← html-parser.ts
  table-converter.ts      ← types.ts
  sanitizer.ts            ← (standalone)
  templates/*             ← (standalone)
  exporter.ts             ← inliner.ts, table-converter.ts, sanitizer.ts, templates/*, (@pen/core)
```

No cycles.

---

## Module: `types.ts` — Layout Types

> **Naming note:** The types below are local to `@pen/layout` and supplement (not replace) the core `LayoutSchema`, `LayoutProps`, and `LayoutChildProps` types defined in `@pen/types` (Wave 0). The core `LayoutSchema` is the **schema declaration** (modes, allowed children, constraints). The types here define **runtime layout configuration** and **extension-specific interfaces**.

```typescript
import type { BlockSchema, BlockProps, LayoutProps, LayoutChildProps } from '@pen/types';

export interface LayoutContainerConfig {
  display: 'flex' | 'grid';

  // Flex properties
  direction?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  wrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  gap?: string;
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  justify?: 'start' | 'center' | 'end' | 'between' | 'around' | 'evenly';

  // Grid properties
  columns?: string;
  rows?: string;
  autoFlow?: 'row' | 'column' | 'dense';

  // Box properties (both modes)
  padding?: string;
  background?: string;
  border?: string;
  borderRadius?: string;
  minHeight?: string;
}

export interface LayoutChildProps {
  width?: string;
  minWidth?: string;
  maxWidth?: string;
  flex?: string;
  order?: number;
  alignSelf?: 'start' | 'center' | 'end' | 'stretch';

  // Grid child properties
  gridColumn?: string;
  gridRow?: string;
  colSpan?: number;
}

> **`LayoutChildProps` merge note:** This interface extends Wave 0's core `LayoutChildProps` by adding `width`, `minWidth`, and `maxWidth`. During Wave 10 implementation, these three fields must be added to the core `LayoutChildProps` in `@pen/types/layout.ts` — they are general CSS child properties needed by any layout system, not layout-extension-specific. The Wave 10 local type shown here will then be removed and the core type imported directly.

export interface LayoutBlockProps extends BlockProps {
  layout: LayoutContainerConfig;
  children: string[];
  backgroundColor?: string;
  borderRadius?: string;
  border?: string;
  minHeight?: string;
}

export interface ColumnBlockProps extends BlockProps {
  layoutChild: LayoutChildProps;
  children: string[];
  backgroundColor?: string;
  padding?: string;
}

export interface LayoutContainerInfo {
  containerId: string;
  containerType: string;
  childIndex: number;
  siblingCount: number;
  layout: LayoutContainerConfig;
  childProps: LayoutChildProps;
}

export type LayoutBlockType = 'section' | 'row' | 'column' | 'stack' | 'card';

export const LAYOUT_BLOCK_TYPES: readonly LayoutBlockType[] = [
  'section', 'row', 'column', 'stack', 'card',
];

export interface ValidParentChild {
  parent: LayoutBlockType | 'root';
  child: LayoutBlockType | 'content';
}

export const VALID_NESTING: ValidParentChild[] = [
  { parent: 'root', child: 'section' },
  { parent: 'root', child: 'content' },
  { parent: 'section', child: 'row' },
  { parent: 'section', child: 'stack' },
  { parent: 'section', child: 'card' },
  { parent: 'section', child: 'content' },
  { parent: 'row', child: 'column' },
  { parent: 'column', child: 'content' },
  { parent: 'column', child: 'stack' },
  { parent: 'column', child: 'card' },
  { parent: 'stack', child: 'content' },
  { parent: 'stack', child: 'card' },
  { parent: 'card', child: 'content' },
  { parent: 'card', child: 'stack' },
];
```

**CRDT children model.** Layout containers store their children in the block's `children` Y.Array (defined in Wave 1's per-block Y.Map structure), not as a JSON prop. The `children` field in the schema props above is the TypeScript representation — at the CRDT level, it maps to `Y.Array<string>`. Operations that move blocks into/out of layout containers use the `{ parent, index }` position variant of `DocumentOp`, which Wave 3's apply pipeline maps to Y.Array insertions. The `index` is 0-based; to append to a container, use `index: children.length` (read the current length from the parent's `children` array or `blockOrder` for root) rather than `-1`. Layout children do NOT appear in the top-level `blockOrder` — they are owned by their parent container. The block renderer for layout containers queries `BlockHandle.children` to get child handles in order.

**Deep iteration.** Because layout children are not in `blockOrder`, any system that needs to visit all blocks in the document (search, export, track changes, attribution) must walk the tree recursively. Use `BlockHandle.children` to descend into layout containers. The normalization pipeline (`normalizeLayout`) walks children recursively for the same reason. Systems that only iterate `blockOrder` will miss layout children — this is by design for rendering (only top-level blocks are rendered in the block list; layout containers render their own children), but must be accounted for in document-wide operations.

**CSS-mapped properties.** Layout properties mirror CSS flexbox/grid names. `display`, `direction`, `gap`, `align`, `justify`. This makes the mental model transparent — if you know CSS, you know the Pen layout system. No abstraction layer.

**Explicit nesting rules.** Not every combination is valid. A `row` can only contain `column` children. A `column` can contain content blocks or nested `stack`/`card`. This prevents nonsensical layouts and makes normalization tractable.

---

## Module: `schemas/section.ts` — Section Block Schema

Top-level layout container. Provides padding, background, max-width.

```typescript
import { defineBlock, prop } from '@pen/types';

export const sectionSchema = defineBlock({
  type: 'section',
  isContainer: true,

  props: {
    layout: prop.object({
      display: prop.enum(['flex']).default('flex'),
      direction: prop.enum(['column']).default('column'),
      gap: prop.string().default('0'),
      align: prop.enum(['start', 'center', 'end', 'stretch']).default('stretch'),
      padding: prop.string().default('0'),
    }),
    maxWidth: prop.string().optional(),
    backgroundColor: prop.string().optional(),
    children: prop.array(prop.string()).default([]),
  },

  serialize: {
    toMarkdown: () => '',
    toHTML: (props) => {
      const style = buildSectionStyle(props);
      return `<section style="${style}">`;
    },
  },
});

function buildSectionStyle(props: Record<string, unknown>): string {
  const layout = props.layout as Record<string, unknown>;
  const parts: string[] = [
    'display: flex',
    `flex-direction: ${layout.direction ?? 'column'}`,
    `gap: ${layout.gap ?? '0'}`,
    `align-items: ${mapAlign(layout.align as string)}`,
  ];
  if (layout.padding) parts.push(`padding: ${layout.padding}`);
  if (props.maxWidth) parts.push(`max-width: ${props.maxWidth}`);
  if (props.backgroundColor) parts.push(`background-color: ${props.backgroundColor}`);
  return parts.join('; ');
}

function mapAlign(align: string): string {
  const map: Record<string, string> = {
    start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch',
  };
  return map[align] ?? 'stretch';
}
```

---

## Module: `schemas/row.ts` — Row Block Schema

Horizontal flex container. Typically holds `column` children.

```typescript
import { defineBlock, prop } from '@pen/types';

export const rowSchema = defineBlock({
  type: 'row',
  isContainer: true,

  props: {
    layout: prop.object({
      display: prop.enum(['flex']).default('flex'),
      direction: prop.enum(['row']).default('row'),
      gap: prop.string().default('16px'),
      align: prop.enum(['start', 'center', 'end', 'stretch']).default('stretch'),
      justify: prop.enum(['start', 'center', 'end', 'between', 'around', 'evenly']).default('start'),
      wrap: prop.enum(['nowrap', 'wrap', 'wrap-reverse']).default('nowrap'),
    }),
    children: prop.array(prop.string()).default([]),
    minHeight: prop.string().optional(),
  },

  serialize: {
    toMarkdown: () => '',
    toHTML: (props) => {
      const layout = props.layout as Record<string, unknown>;
      const parts = [
        'display: flex',
        'flex-direction: row',
        `gap: ${layout.gap ?? '16px'}`,
        `align-items: ${mapAlign(layout.align as string)}`,
        `justify-content: ${mapJustify(layout.justify as string)}`,
      ];
      if (layout.wrap) parts.push('flex-wrap: wrap');
      return `<div style="${parts.join('; ')}">`;
    },
  },
});

function mapAlign(align: string): string {
  const map: Record<string, string> = {
    start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch',
  };
  return map[align] ?? 'stretch';
}

function mapJustify(justify: string): string {
  const map: Record<string, string> = {
    start: 'flex-start', center: 'center', end: 'flex-end',
    between: 'space-between', around: 'space-around', evenly: 'space-evenly',
  };
  return map[justify] ?? 'flex-start';
}
```

---

## Module: `schemas/column.ts` — Column Block Schema

Child of `row`. Defines its own width/flex within the parent.

```typescript
import { defineBlock, prop } from '@pen/types';

export const columnSchema = defineBlock({
  type: 'column',
  isContainer: true,

  props: {
    layoutChild: prop.object({
      width: prop.string().optional(),
      minWidth: prop.string().default('0'),
      flex: prop.string().default('1'),
      alignSelf: prop.enum(['start', 'center', 'end', 'stretch']).optional(),
    }),
    children: prop.array(prop.string()).default([]),
    backgroundColor: prop.string().optional(),
    padding: prop.string().default('16px'),
  },

  serialize: {
    toMarkdown: () => '',
    toHTML: (props) => {
      const lc = props.layoutChild as Record<string, unknown>;
      const parts: string[] = [];
      if (lc.width) parts.push(`width: ${lc.width}`);
      if (lc.flex) parts.push(`flex: ${lc.flex}`);
      if (lc.minWidth) parts.push(`min-width: ${lc.minWidth}`);
      if (lc.alignSelf) parts.push(`align-self: ${lc.alignSelf}`);
      if (props.padding) parts.push(`padding: ${props.padding}`);
      if (props.backgroundColor) parts.push(`background-color: ${props.backgroundColor}`);
      return `<div style="${parts.join('; ')}">`;
    },
  },
});
```

---

## Module: `schemas/stack.ts` — Vertical Stack Schema

Simple vertical container. Like a section but without max-width/background concerns. Used inside columns for vertical grouping.

```typescript
import { defineBlock, prop } from '@pen/types';

export const stackSchema = defineBlock({
  type: 'stack',
  isContainer: true,

  props: {
    gap: prop.string().default('8px'),
    align: prop.enum(['start', 'center', 'end', 'stretch']).default('stretch'),
    children: prop.array(prop.string()).default([]),
    padding: prop.string().optional(),
  },

  serialize: {
    toMarkdown: () => '',
    toHTML: (props) => {
      const parts = [
        'display: flex',
        'flex-direction: column',
        `gap: ${props.gap ?? '8px'}`,
        `align-items: ${mapAlign(props.align as string)}`,
      ];
      if (props.padding) parts.push(`padding: ${props.padding}`);
      return `<div style="${parts.join('; ')}">`;
    },
  },
});

function mapAlign(align: string): string {
  const map: Record<string, string> = {
    start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch',
  };
  return map[align] ?? 'stretch';
}
```

---

## Module: `schemas/card.ts` — Card Block Schema

Bordered container with optional shadow. Used for visually distinct groupings.

```typescript
import { defineBlock, prop } from '@pen/types';

export const cardSchema = defineBlock({
  type: 'card',
  isContainer: true,

  props: {
    children: prop.array(prop.string()).default([]),
    padding: prop.string().default('16px'),
    borderRadius: prop.string().default('8px'),
    border: prop.string().default('1px solid #e5e7eb'),
    backgroundColor: prop.string().optional(),
    shadow: prop.enum(['none', 'sm', 'md', 'lg']).default('none'),
  },

  serialize: {
    toMarkdown: () => '',
    toHTML: (props) => {
      const shadows: Record<string, string> = {
        none: 'none',
        sm: '0 1px 2px rgba(0,0,0,0.05)',
        md: '0 4px 6px rgba(0,0,0,0.1)',
        lg: '0 10px 15px rgba(0,0,0,0.1)',
      };
      const parts = [
        `padding: ${props.padding}`,
        `border-radius: ${props.borderRadius}`,
        `border: ${props.border}`,
        `box-shadow: ${shadows[props.shadow as string] ?? 'none'}`,
      ];
      if (props.backgroundColor) parts.push(`background-color: ${props.backgroundColor}`);
      return `<div style="${parts.join('; ')}">`;
    },
  },
});
```

---

## Module: `operations/wrap.ts` — Wrap Blocks in Layout

Takes one or more content blocks and wraps them in a layout structure.

```typescript
import type { Editor, DocumentOp, Position } from '@pen/types';
import type { LayoutContainerConfig, LayoutChildProps } from '../types.js';

export interface WrapOptions {
  blockIds: string[];
  layout: 'two-column' | 'three-column' | 'sidebar-left' | 'sidebar-right' | 'equal-columns' | 'custom';
  columnWidths?: string[];
  gap?: string;
}

export function buildWrapOps(
  editor: Editor,
  options: WrapOptions,
): DocumentOp[] {
  const { blockIds, layout, gap } = options;
  if (blockIds.length === 0) return [];

  const columnConfigs = resolveColumnConfigs(layout, blockIds.length, options.columnWidths);

  const sectionId = crypto.randomUUID();
  const rowId = crypto.randomUUID();

  const firstBlockId = blockIds[0];
  const ops: DocumentOp[] = [];

  // Step 1: Create the section container (insert before the first wrapped block)
  ops.push({
    type: 'insert-block',
    blockId: sectionId,
    blockType: 'section',
    props: {
      layout: { display: 'flex', direction: 'column', gap: '0', align: 'stretch', padding: '0' },
      children: [rowId],
    },
    position: { before: firstBlockId },
  });

  // Step 2: Create the row (inside the section — row must exist before columns reference it)
  const columnIds: string[] = [];
  const columnConfigs2 = columnConfigs;
  for (let i = 0; i < columnConfigs2.length; i++) {
    columnIds.push(crypto.randomUUID());
  }

  ops.push({
    type: 'insert-block',
    blockId: rowId,
    blockType: 'row',
    props: {
      layout: {
        display: 'flex',
        direction: 'row',
        gap: gap ?? '16px',
        align: 'stretch',
        justify: 'start',
        wrap: 'nowrap',
      },
      children: columnIds,
    },
    position: { parent: sectionId, index: 0 },
  });

  // Step 3: Create columns (inside the row)
  for (let i = 0; i < columnConfigs2.length; i++) {
    const childBlockIds = columnConfigs2[i].blockIds;

    ops.push({
      type: 'insert-block',
      blockId: columnIds[i],
      blockType: 'column',
      props: {
        layoutChild: {
          flex: columnConfigs2[i].flex,
          width: columnConfigs2[i].width,
          minWidth: '0',
        },
        children: childBlockIds,
        padding: '16px',
      },
      position: { parent: rowId, index: i },
    });
  }

  // Step 4: Distribute blocks across columns (round-robin when no explicit assignment)
  // Position.index is 0-based; to append, use index = children.length (see note below).
  const columnCounts = columnIds.map((_, i) => columnConfigs2[i].blockIds.length);
  for (let i = 0; i < blockIds.length; i++) {
    const colIndex = i % columnIds.length;
    const targetColumn = columnIds[colIndex];
    const index = columnCounts[colIndex];
    columnCounts[colIndex]++;
    ops.push({ type: 'move-block', blockId: blockIds[i], position: { parent: targetColumn, index } });
  }

  return ops;
}

interface ColumnConfig {
  flex: string;
  width?: string;
  blockIds: string[];
}

function resolveColumnConfigs(
  layout: WrapOptions['layout'],
  blockCount: number,
  customWidths?: string[],
): ColumnConfig[] {
  switch (layout) {
    case 'two-column':
      return [
        { flex: '1', blockIds: [] },
        { flex: '1', blockIds: [] },
      ];
    case 'three-column':
      return [
        { flex: '1', blockIds: [] },
        { flex: '1', blockIds: [] },
        { flex: '1', blockIds: [] },
      ];
    case 'sidebar-left':
      return [
        { flex: '0 0 250px', width: '250px', blockIds: [] },
        { flex: '1', blockIds: [] },
      ];
    case 'sidebar-right':
      return [
        { flex: '1', blockIds: [] },
        { flex: '0 0 250px', width: '250px', blockIds: [] },
      ];
    case 'equal-columns': {
      const count = Math.max(2, Math.min(blockCount, 6));
      return Array.from({ length: count }, () => ({
        flex: '1', blockIds: [],
      }));
    }
    case 'custom': {
      if (!customWidths || customWidths.length < 2) {
        return [{ flex: '1', blockIds: [] }, { flex: '1', blockIds: [] }];
      }
      return customWidths.map(w => ({
        flex: w.endsWith('px') ? `0 0 ${w}` : w,
        width: w.endsWith('px') ? w : undefined,
        blockIds: [],
      }));
    }
  }
}
```

---

## Module: `operations/unwrap.ts` — Unwrap Layout Container

Extracts content blocks from a layout container and places them back into the flat document.

```typescript
import type { Editor, DocumentOp } from '@pen/types';
import { LAYOUT_BLOCK_TYPES } from '../types.js';

export function buildUnwrapOps(
  editor: Editor,
  containerId: string,
): DocumentOp[] {
  const ops: DocumentOp[] = [];
  const container = editor.getBlock(containerId);
  if (!container) return [];

  const contentBlockIds = collectContentBlocks(editor, containerId);

  for (let i = contentBlockIds.length - 1; i >= 0; i--) {
    ops.push({
      type: 'move-block',
      blockId: contentBlockIds[i],
      position: { after: containerId },
    });
  }

  const layoutBlockIds = collectLayoutBlocks(editor, containerId);
  for (const id of layoutBlockIds) {
    ops.push({ type: 'delete-block', blockId: id });
  }

  ops.push({ type: 'delete-block', blockId: containerId });

  return ops;
}

function collectContentBlocks(editor: Editor, containerId: string): string[] {
  const result: string[] = [];
  const container = editor.getBlock(containerId);
  if (!container) return result;

  const children = (container.props.children as string[]) ?? [];
  for (const childId of children) {
    const child = editor.getBlock(childId);
    if (!child) continue;

    if ((LAYOUT_BLOCK_TYPES as readonly string[]).includes(child.type)) {
      result.push(...collectContentBlocks(editor, childId));
    } else {
      result.push(childId);
    }
  }

  return result;
}

function collectLayoutBlocks(editor: Editor, containerId: string): string[] {
  const result: string[] = [];
  const container = editor.getBlock(containerId);
  if (!container) return result;

  const children = (container.props.children as string[]) ?? [];
  for (const childId of children) {
    const child = editor.getBlock(childId);
    if (!child) continue;

    if ((LAYOUT_BLOCK_TYPES as readonly string[]).includes(child.type)) {
      result.push(...collectLayoutBlocks(editor, childId));
      result.push(childId);
    }
  }

  return result;
}
```

---

## Module: `operations/resize.ts` — Column Resize

Redistributes flex values between adjacent columns when a resizer is dragged.

```typescript
import type { Editor, DocumentOp } from '@pen/types';
import type { LayoutChildProps } from '../types.js';

export interface ResizeEvent {
  rowId: string;
  resizerIndex: number;
  deltaPixels: number;
  containerWidth: number;
}

export function buildResizeOps(
  editor: Editor,
  event: ResizeEvent,
): DocumentOp[] {
  const row = editor.getBlock(event.rowId);
  if (!row) return [];

  const children = (row.props.children as string[]) ?? [];
  if (event.resizerIndex >= children.length - 1) return [];

  const leftId = children[event.resizerIndex];
  const rightId = children[event.resizerIndex + 1];

  const leftCol = editor.getBlock(leftId);
  const rightCol = editor.getBlock(rightId);
  if (!leftCol || !rightCol) return [];

  const leftLayoutChild = leftCol.props.layoutChild as LayoutChildProps | undefined;
  const rightLayoutChild = rightCol.props.layoutChild as LayoutChildProps | undefined;
  const leftFlex = parseFloat(leftLayoutChild?.flex ?? '1');
  const rightFlex = parseFloat(rightLayoutChild?.flex ?? '1');
  const totalFlex = leftFlex + rightFlex;

  const deltaPct = event.deltaPixels / event.containerWidth;
  const deltaFlex = deltaPct * totalFlex;

  const newLeftFlex = Math.max(0.1, leftFlex + deltaFlex);
  const newRightFlex = Math.max(0.1, totalFlex - newLeftFlex);

  return [
    {
      type: 'update-block',
      blockId: leftId,
      props: {
        layoutChild: {
          ...leftLayoutChild,
          flex: String(Math.round(newLeftFlex * 100) / 100),
        },
      },
    },
    {
      type: 'update-block',
      blockId: rightId,
      props: {
        layoutChild: {
          ...rightLayoutChild,
          flex: String(Math.round(newRightFlex * 100) / 100),
        },
      },
    },
  ];
}
```

**Conservation of flex.** Total flex between the two adjacent columns is preserved. Dragging left makes the left column narrower, right wider, and vice versa. Minimum flex is 0.1 to prevent zero-width columns.

---

## Module: `normalization/layout-rules.ts` — Layout Normalization (Rule 6)

```typescript
import type { Editor, BlockHandle, DocumentOp } from '@pen/types';
import { LAYOUT_BLOCK_TYPES, VALID_NESTING, type LayoutBlockType } from '../types.js';

export function normalizeLayout(editor: Editor): DocumentOp[] {
  const ops: DocumentOp[] = [];

  // Walk all blocks including layout children (which are not in blockOrder).
  // Top-level layout containers are found via blockOrder; their nested
  // children are reached by recursively walking BlockHandle.children.
  const visited = new Set<string>();

  function visit(block: BlockHandle): void {
    if (visited.has(block.id)) return;
    visited.add(block.id);

    if (LAYOUT_BLOCK_TYPES.includes(block.type as LayoutBlockType)) {
      ops.push(...normalizeChildren(editor, block));
      ops.push(...normalizeEmptyContainer(editor, block));
      ops.push(...normalizeNesting(editor, block));

      for (const child of block.children) {
        visit(child);
      }
    }
  }

  const blockOrder = editor.documentState.blockOrder;
  for (const blockId of blockOrder) {
    const block = editor.getBlock(blockId);
    if (!block) continue;
    visit(block);
  }

  return ops;
}

function normalizeChildren(editor: Editor, block: BlockHandle): DocumentOp[] {
  const children = (block.props.children as string[]) ?? [];
  const validChildren = children.filter(id => editor.getBlock(id) !== null);

  if (validChildren.length !== children.length) {
    return [{
      type: 'update-block',
      blockId: block.id,
      props: { children: validChildren },
    }];
  }

  return [];
}

function normalizeEmptyContainer(editor: Editor, block: BlockHandle): DocumentOp[] {
  const children = (block.props.children as string[]) ?? [];
  if (children.length > 0) return [];

  if (block.type === 'column') {
    const paragraphId = crypto.randomUUID();
    return [
      {
        type: 'insert-block',
        blockId: paragraphId,
        blockType: 'paragraph',
        props: {},
        position: { parent: block.id, index: 0 },
      },
      {
        type: 'update-block',
        blockId: block.id,
        props: { children: [paragraphId] },
      },
    ];
  }

  return [{ type: 'delete-block', blockId: block.id }];
}

function normalizeNesting(editor: Editor, block: BlockHandle): DocumentOp[] {
  const parent = getParentBlock(editor, block.id);
  const parentType: string = parent ? parent.type : 'root';

  const isValid = VALID_NESTING.some(rule =>
    rule.parent === parentType &&
    (LAYOUT_BLOCK_TYPES.includes(block.type as LayoutBlockType)
      ? rule.child === block.type
      : rule.child === 'content')
  );

  if (!isValid) {
    const rootChildIds = editor.documentState.blockOrder; // root's direct children
    return [{ type: 'move-block', blockId: block.id, position: { parent: 'root', index: rootChildIds.length } }];
  }

  return [];
}

function getParentBlock(editor: Editor, blockId: string): BlockHandle | null {
  const blockOrder = editor.documentState.blockOrder;
  for (const id of blockOrder) {
    const block = editor.getBlock(id);
    if (!block) continue;
    const children = (block.props.children as string[]) ?? [];
    if (children.includes(blockId)) return block;
  }
  return null;
}
```

**Rule 6 from the spec.** Layout normalization ensures:
1. Dead references in `children` arrays are removed.
2. Empty `column` containers get an auto-inserted paragraph.
3. Other empty containers (row with no columns, section with no children) are deleted.
4. Invalid nesting (e.g. a `row` inside a `column`) is corrected by moving the block to root.

---

## Module: `tools/wrap-in-columns.ts` — LLM Layout Tool

```typescript
import type { ToolDefinition } from '@pen/types';
import { buildWrapOps, type WrapOptions } from '../operations/wrap.js';

export const wrapInColumnsTool: ToolDefinition = {
  name: 'wrap_in_columns',
  description: 'Wrap one or more blocks in a multi-column layout. Supports preset layouts (two-column, three-column, sidebar-left, sidebar-right) or custom column widths.',
  inputSchema: {
    type: 'object',
    properties: {
      blockIds: {
        type: 'array',
        items: { type: 'string' },
        description: 'Block IDs to wrap in the layout',
      },
      layout: {
        type: 'string',
        enum: ['two-column', 'three-column', 'sidebar-left', 'sidebar-right', 'equal-columns', 'custom'],
        description: 'Preset layout or custom',
      },
      columnWidths: {
        type: 'array',
        items: { type: 'string' },
        description: 'Custom column widths (e.g. ["1", "2", "1"] for flex ratios or ["200px", "1fr"])',
      },
      gap: {
        type: 'string',
        description: 'Gap between columns (CSS value, default "16px")',
      },
    },
    required: ['blockIds', 'layout'],
  },

  execute(input, ctx) {
    const { blockIds, layout } = input as { blockIds: string[]; layout: string };
    const ops = buildWrapOps(ctx.editor, input as WrapOptions);
    ctx.editor.apply(ops, { origin: 'ai' });
    return { success: true, message: `Wrapped ${blockIds.length} blocks in ${layout} layout` };
  },
};
```

---

## Module: `tools/set-layout.ts` — LLM Set Layout Properties

```typescript
import type { ToolDefinition } from '@pen/types';

export const setLayoutTool: ToolDefinition = {
  name: 'set_layout',
  description: 'Update layout properties on a layout container (section, row, column, stack, card)',
  inputSchema: {
    type: 'object',
    properties: {
      blockId: { type: 'string', description: 'Block ID of the layout container' },
      properties: {
        type: 'object',
        description: 'Layout properties to update (gap, align, justify, padding, backgroundColor, etc.)',
      },
    },
    required: ['blockId', 'properties'],
  },

  execute(input, ctx) {
    const { blockId, properties } = input as { blockId: string; properties: Record<string, unknown> };
    const block = ctx.editor.getBlock(blockId);
    if (!block) return { success: false, error: 'Block not found' };

    ctx.editor.apply([{
      type: 'update-block', blockId, props: properties,
    }], { origin: 'ai' });

    return { success: true };
  },
};
```

---

## Layout Primitives

### `Pen.Layout.Container`

Renders a layout container block (section, row, column, stack, card). Applies CSS flex/grid styles from props.

```typescript
interface ContainerProps {
  blockId: string;
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-layout-container]
// [data-layout-type]     - 'section' | 'row' | 'column' | 'stack' | 'card'
// [data-layout-display]  - 'flex' | 'grid'
// [data-layout-direction] - 'row' | 'column'
// [data-child-count]
// [data-empty]            - container has no children
```

### `Pen.Layout.Item`

Renders a block within a layout container. Applies `layoutChild` CSS (flex, width, align-self).

```typescript
interface ItemProps {
  blockId: string;
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-layout-item]
// [data-layout-index]
```

### `Pen.Layout.Resizer`

Draggable handle between adjacent columns. Horizontal drag redistributes flex.

```typescript
interface ResizerProps {
  rowId: string;
  index: number;
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-layout-resizer]
// [data-dragging]          - resizer is being dragged
// [data-orientation]       - 'horizontal' | 'vertical'
```

### `Pen.Layout.DropZone`

Drop target for drag-and-drop block movement into layout containers.

```typescript
interface DropZoneProps {
  containerId: string;
  index: number;
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-layout-drop-zone]
// [data-drag-over]
// [data-position]  - 'before' | 'after' | 'inside'
```

### `Pen.Layout.Breakpoint`

Responsive breakpoint wrapper. Renders different layouts at different viewport widths.

```typescript
interface BreakpointProps {
  breakpoints?: {
    sm?: number;
    md?: number;
    lg?: number;
  };
  children?: React.ReactNode;
}

// Data attributes:
// [data-pen-layout-breakpoint]
// [data-breakpoint]   - 'sm' | 'md' | 'lg'
```

---

## Module: `@pen/export-email — exporter.ts`

Email clients don't support flexbox. The email exporter converts flexbox layouts to table-based HTML with inlined CSS.

```typescript
import type { Editor, BlockHandle } from '@pen/types';
import type { LayoutContainerConfig } from '@pen/layout';
import { convertToTables } from './table-converter.js';
import { inlineCSS } from './inliner.js';
import { sanitizeForEmail } from './sanitizer.js';
import { wrapInTemplate } from './templates/wrapper.js';
import { EMAIL_CSS_RESET } from './templates/reset.js';

export interface EmailExportOptions {
  maxWidth?: number;
  darkMode?: boolean;
  inlineImages?: boolean;
}

export function exportToEmail(
  editor: Editor,
  options: EmailExportOptions = {},
): string {
  const maxWidth = options.maxWidth ?? 600;
  const blocks = editor.documentState.blockOrder;

  let html = '';
  function renderBlock(block: BlockHandle): void {
    html += renderBlockToEmailHTML(block, editor);
    for (const child of block.children) {
      renderBlock(child);
    }
  }
  for (const blockId of blocks) {
    const block = editor.getBlock(blockId);
    if (!block) continue;
    renderBlock(block);
  }

  html = convertToTables(html, maxWidth);
  html = sanitizeForEmail(html);
  html = inlineCSS(html, EMAIL_CSS_RESET);
  html = wrapInTemplate(html, { maxWidth, darkMode: options.darkMode });

  return html;
}

function renderBlockToEmailHTML(block: BlockHandle, editor: Editor): string {
  const type = block.type;

  if (type === 'row') {
    return renderRowAsTable(block, editor);
  }

  if (type === 'column') {
    return renderColumnAsTableCell(block, editor);
  }

  return block.serialize?.('html') ?? `<p>${block.textContent()}</p>`;
}

function renderRowAsTable(block: BlockHandle, editor: Editor): string {
  const children = (block.props.children as string[]) ?? [];
  const layoutProps = block.props.layout as LayoutContainerConfig | undefined;
  const gap = layoutProps?.gap ?? '16px';

  let cells = '';
  for (const childId of children) {
    const child = editor.getBlock(childId);
    if (!child) continue;
    cells += renderColumnAsTableCell(child, editor);
  }

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse;"><tr>${cells}</tr></table>`;
}

function renderColumnAsTableCell(block: BlockHandle, editor: Editor): string {
  const lc = block.props.layoutChild as Record<string, unknown> | undefined;
  const flex = parseFloat((lc?.flex as string) ?? '1');
  const children = (block.props.children as string[]) ?? [];

  let innerHtml = '';
  for (const childId of children) {
    const child = editor.getBlock(childId);
    if (!child) continue;
    innerHtml += renderBlockToEmailHTML(child, editor);
  }

  const widthAttr = lc?.width ? `width="${lc.width}"` : '';
  const padding = block.props.padding ?? '16px';

  return `<td ${widthAttr} style="vertical-align: top; padding: ${padding};">${innerHtml}</td>`;
}
```

**Flexbox → table conversion.** Rows become `<table>` with `<tr>`. Columns become `<td>`. Column flex ratios are converted to percentage widths when no explicit width is set. This produces email-safe HTML that renders correctly in Gmail, Outlook, Apple Mail.

---

## Module: `@pen/export-email — inliner.ts`

```typescript
/**
 * CSS inlining engine.
 *
 * Uses a lightweight HTML parser (not regex) to traverse the document tree
 * and apply matching CSS rules as inline styles. For M2, we support element
 * selectors and class selectors — sufficient for the generated email HTML
 * which uses simple, predictable selectors.
 *
 * For production use with arbitrary HTML, consider delegating to `juice`
 * (MIT, ~50KB) which handles specificity, media queries, and pseudo-selectors.
 */

import { parseHTML, type HTMLNode } from './html-parser.js';

export function inlineCSS(html: string, cssText: string): string {
  const rules = parseCSSRules(cssText);
  const doc = parseHTML(html);

  for (const node of walkNodes(doc)) {
    const matchingRules = rules.filter(rule => matchesSelector(node, rule.selector));
    if (matchingRules.length === 0) continue;

    const declarations = matchingRules.map(r => r.declarations).join('; ');
    const existing = node.attributes?.style ?? '';
    node.attributes = {
      ...node.attributes,
      style: existing ? `${existing}; ${declarations}` : declarations,
    };
  }

  return serializeHTML(doc);
}

interface CSSRule {
  selector: string;
  declarations: string;
}

function parseCSSRules(css: string): CSSRule[] {
  const rules: CSSRule[] = [];
  const ruleRegex = /([^{]+)\{([^}]+)\}/g;
  let match: RegExpExecArray | null;

  while ((match = ruleRegex.exec(css)) !== null) {
    rules.push({
      selector: match[1].trim(),
      declarations: match[2].trim(),
    });
  }

  return rules;
}

function matchesSelector(node: HTMLNode, selector: string): boolean {
  if (selector.startsWith('.')) {
    const className = selector.slice(1);
    return (node.attributes?.class ?? '').split(/\s+/).includes(className);
  }
  return node.tag === selector;
}

function* walkNodes(node: HTMLNode): Iterable<HTMLNode> {
  yield node;
  for (const child of node.children ?? []) {
    yield* walkNodes(child);
  }
}

function serializeHTML(node: HTMLNode): string {
  // Serialize back to HTML string
  // Implementation delegates to the html-parser module
  return '';
}
```

---

## Dependencies

### `@pen/layout`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@pen/react": "workspace:*",
    "react": "^19.0.0"
  }
}
```

### `@pen/export-email`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@pen/layout": "workspace:*"
  }
}
```

No external dependencies. The CSS inliner and table converter are simple enough to implement without a library.

---

## Key Decisions

- **Retrofit requirement for document-wide operations.** Layout children do NOT appear in `blockOrder`. All code that must visit every block in the document — exporters (Wave 4), search (Wave 9), track changes (Wave 7), attribution (Wave 8), JSON export (Wave 12) — MUST use `DocumentState.allBlocks()` or recursive `BlockHandle.descendants()` traversal, NOT `blockOrder` iteration. This is the most significant cross-wave impact of the layout system. Each affected wave's implementation must be audited to ensure exhaustive traversal.

1. **CSS-mapped properties.** Layout properties (`display`, `direction`, `gap`, `align`, `justify`) mirror CSS names directly. No abstraction layer. If you know CSS flexbox, you know the Pen layout model.

2. **Explicit nesting rules.** Not all combinations are valid. `row` → `column` only. `column` → content or `stack`/`card`. This prevents impossible layouts and simplifies normalization.

3. **Conservation of flex on resize.** Total flex between two adjacent columns is preserved during drag-resize. This ensures the overall row width stays consistent.

4. **Empty columns get auto-paragraphs.** An empty column is not useful — normalization inserts a blank paragraph so the user has a place to type.

5. **Empty non-column containers are deleted.** A section with no children, a row with no columns — these are removed during normalization.

6. **Email export uses table-based layout.** Flexbox is not supported in email clients. The exporter converts `row` → `<table><tr>`, `column` → `<td>`. CSS is inlined. Images can optionally be inlined as base64.

7. **Unwrap preserves content order.** When unwrapping a layout, content blocks are extracted in document order and placed after the layout container's position. Layout container blocks are then deleted.

8. **LLM tools for layout.** Three tools: `wrap_in_columns` (create layout from blocks), `set_layout` (update properties), `remove_layout` (unwrap). These allow AI to reason about and create layouts.

---

## Acceptance Criteria

1. `section`, `row`, `column`, `stack`, `card` block schemas register correctly.
2. Wrapping 3 blocks in a two-column layout creates section → row → 2 columns.
3. Wrapping in sidebar-left creates a 250px fixed column + 1fr flexible column.
4. Unwrapping a layout container extracts all content blocks and deletes layout blocks.
5. Column resizer drag redistributes flex between adjacent columns. Minimum flex is 0.1.
6. Empty columns auto-insert a paragraph during normalization.
7. Empty sections/rows are auto-deleted during normalization.
8. Invalid nesting (row inside column) is corrected by normalization.
9. Dead children references in `children` arrays are cleaned up.
10. `wrap_in_columns` LLM tool creates correct layout structure.
11. `set_layout` LLM tool updates layout properties.
12. `remove_layout` LLM tool unwraps layout and flattens blocks.
13. `Pen.Layout.Container` renders correct CSS flex styles from layout props.
14. `Pen.Layout.Item` applies `layoutChild` CSS (flex, width, align-self).
15. `Pen.Layout.Resizer` is draggable and produces resize operations.
16. `Pen.Layout.DropZone` accepts dragged blocks.
17. `Pen.Layout.Breakpoint` switches row to stacked layout below breakpoint width.
18. Email export converts flexbox layouts to table-based HTML.
19. Email export inlines all CSS.
20. Email export renders correctly in Gmail, Outlook, and Apple Mail.
21. All layout primitives support `asChild`, forward refs, render no styles, and expose `data-*` attributes.
