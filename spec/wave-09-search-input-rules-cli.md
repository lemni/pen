# Wave 9 — Search, Input Rules & CLI

**Milestone:** M1 · **Packages:** `@pen/search`, `@pen/input-rules`, `@pen/export-markdown` (update), `@pen/export-html` (update), `@pen/cli` · **Depends on:** M0 (Waves 0-6), Wave 7

---

## Goal

Ship document search with decoration-based highlighting, auto-formatting input rules (Markdown shortcuts), suggestion-aware export (CriticMarkup / `<ins>` `<del>`), and the `pen create` scaffolding CLI. After this wave, users can find-and-replace within documents, type `# ` to get a heading, export documents that contain track-changes markup, and scaffold new Pen projects from templates.

---

## File Structure

### `@pen/search`

```
packages/extensions/search/src/
├── extension.ts            defineExtension — entry point
├── engine.ts               Search engine: find, findAll, replace, replaceAll
├── match.ts                Match computation (regex, plain text, case-sensitive)
├── decorations.ts          Decoration producer for search highlights
├── types.ts                Search-specific types
├── hooks/
│   ├── use-search.ts       useSearch() — search state, query, matches
│   └── index.ts            Barrel
├── primitives/
│   ├── root.tsx            Pen.Search.Root — context provider
│   ├── input.tsx           Pen.Search.Input — search field
│   ├── results.tsx         Pen.Search.Results — match count display
│   ├── navigation.tsx      Pen.Search.Next / Pen.Search.Previous
│   ├── replace-input.tsx   Pen.Search.ReplaceInput
│   ├── replace-button.tsx  Pen.Search.Replace / Pen.Search.ReplaceAll
│   ├── toggle.tsx          Pen.Search.CaseSensitive / RegExp / WholeWord
│   └── index.ts            Barrel
└── index.ts                Package entry
```

### `@pen/input-rules`

```
packages/extensions/input-rules/src/
├── extension.ts            defineExtension — entry point, keystroke interceptor
├── engine.ts               Input rule matching engine
├── default-rules.ts        Built-in Markdown shortcut rules
├── types.ts                InputRule type definition
└── index.ts                Package entry
```

### `@pen/cli`

```
packages/cli/src/
├── index.ts                Entry point (bin)
├── commands/
│   ├── create.ts           pen create — scaffold project
│   ├── dev.ts              pen dev — start dev server (future)
│   └── help.ts             pen help
├── templates/
│   ├── registry.ts         Template registry
│   ├── minimal.ts          Minimal template definition
│   ├── full.ts             Full template definition
│   └── custom.ts           Custom template loader (git URL)
├── scaffold.ts             File generation from template
├── prompts.ts              Interactive prompts (project name, template, options)
├── package-manager.ts      Detect and run pnpm/npm/yarn/bun
└── index.ts                Package entry
```

### Import DAG

```
@pen/search:
  types.ts           ← (@pen/types)
  match.ts           ← types.ts
  engine.ts          ← match.ts, types.ts, (@pen/types)
  decorations.ts     ← engine.ts, types.ts, (@pen/types)
  extension.ts       ← engine.ts, decorations.ts, (@pen/types)
  hooks/*            ← extension.ts, types.ts, (react)
  primitives/*       ← hooks/*, (react)

@pen/input-rules:
  types.ts           ← (@pen/types)
  engine.ts          ← types.ts, (@pen/types)
  default-rules.ts   ← types.ts
  extension.ts       ← engine.ts, default-rules.ts, (@pen/types)

@pen/cli:
  commands/create.ts ← scaffold.ts, prompts.ts, templates/registry.ts
  scaffold.ts        ← package-manager.ts
  prompts.ts         ← (standalone, readline/inquirer)
  templates/*        ← (standalone)
  package-manager.ts ← (standalone)
```

No cycles.

---

## Module: `@pen/search — types.ts`

```typescript
import type { Position } from '@pen/types';

export interface SearchState {
  query: string;
  matches: SearchMatch[];
  activeIndex: number;
  options: SearchOptions;
  replaceText: string;
}

export interface SearchOptions {
  caseSensitive: boolean;
  regex: boolean;
  wholeWord: boolean;
  debounceMs?: number;
}

export interface SearchMatch {
  blockId: string;
  from: number;
  to: number;
  text: string;
  index: number;
}

export interface SearchQuery {
  text: string;
  options: SearchOptions;
}
```

---

## Module: `@pen/search — match.ts` — Match Computation

Builds a `RegExp` from the search query respecting options, then runs it against block text content.

```typescript
import type { SearchOptions, SearchMatch } from './types.js';

export function findMatchesInText(
  text: string,
  query: string,
  options: SearchOptions,
  blockId: string,
  startIndex: number,
): SearchMatch[] {
  if (!query) return [];

  const regex = buildRegex(query, options);
  const matches: SearchMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    matches.push({
      blockId,
      from: match.index,
      to: match.index + match[0].length,
      text: match[0],
      index: startIndex + matches.length,
    });

    if (!regex.global) break;
    if (match[0].length === 0) regex.lastIndex++;
  }

  return matches;
}

function buildRegex(query: string, options: SearchOptions): RegExp {
  let pattern: string;

  if (options.regex) {
    pattern = query;
  } else {
    pattern = escapeRegExp(query);
  }

  if (options.wholeWord) {
    pattern = `\\b${pattern}\\b`;
  }

  const flags = options.caseSensitive ? 'g' : 'gi';

  try {
    return new RegExp(pattern, flags);
  } catch {
    return new RegExp(escapeRegExp(query), flags);
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
```

**Regex fallback.** If the user enables regex mode and their pattern is invalid, fall back to escaped literal matching rather than throwing.

---

## Module: `@pen/search — engine.ts` — Search Engine

```typescript
import type { Editor, DocumentOp } from '@pen/types';
import type { SearchState, SearchMatch, SearchOptions } from './types.js';
import { findMatchesInText } from './match.js';

export class SearchEngine {
  private editor: Editor;
  private _state: SearchState = {
    query: '',
    matches: [],
    activeIndex: -1,
    options: { caseSensitive: false, regex: false, wholeWord: false },
    replaceText: '',
  };
  private listeners = new Set<() => void>();

  constructor(editor: Editor) {
    this.editor = editor;
  }

  get state(): Readonly<SearchState> { return this._state; }

  setQuery(query: string): void {
    this._state = { ...this._state, query, activeIndex: -1 };
    this.recompute();
  }

  setOptions(options: Partial<SearchOptions>): void {
    this._state = {
      ...this._state,
      options: { ...this._state.options, ...options },
      activeIndex: -1,
    };
    this.recompute();
  }

  setReplaceText(text: string): void {
    this._state = { ...this._state, replaceText: text };
    this.notify();
  }

  next(): void {
    if (this._state.matches.length === 0) return;
    const nextIndex = (this._state.activeIndex + 1) % this._state.matches.length;
    this._state = { ...this._state, activeIndex: nextIndex };
    this.scrollToActiveMatch();
    this.notify();
  }

  previous(): void {
    if (this._state.matches.length === 0) return;
    const prevIndex = this._state.activeIndex <= 0
      ? this._state.matches.length - 1
      : this._state.activeIndex - 1;
    this._state = { ...this._state, activeIndex: prevIndex };
    this.scrollToActiveMatch();
    this.notify();
  }

  replace(): void {
    const match = this._state.matches[this._state.activeIndex];
    if (!match) return;

    const ops: DocumentOp[] = [
      { type: 'delete-text', blockId: match.blockId, offset: match.from, length: match.to - match.from },
      { type: 'insert-text', blockId: match.blockId, offset: match.from, text: this._state.replaceText },
    ];

    this.editor.apply(ops, { origin: 'user', undoGroup: true });
    this.recompute();
  }

  replaceAll(): void {
    if (this._state.matches.length === 0) return;

    const ops: DocumentOp[] = [];

    // > **Offset correction.** When building ops for `replaceAll`, ops within the same block must account for text length changes from earlier ops. Process matches in reverse offset order within each block (highest offset first). This ensures earlier offsets are unaffected by later deletions/insertions. The current code sorts by `blockId` then descending `offset` — verify this ordering is maintained in implementation.

    const matchesByBlock = new Map<string, SearchMatch[]>();
    for (const match of this._state.matches) {
      const existing = matchesByBlock.get(match.blockId) ?? [];
      existing.push(match);
      matchesByBlock.set(match.blockId, existing);
    }

    for (const [blockId, matches] of matchesByBlock) {
      const sorted = matches.sort((a, b) => b.from - a.from);
      for (const match of sorted) {
        ops.push({
          type: 'delete-text', blockId, offset: match.from, length: match.to - match.from,
        });
        ops.push({
          type: 'insert-text', blockId, offset: match.from, text: this._state.replaceText,
        });
      }
    }

    this.editor.apply(ops, { origin: 'user', undoGroup: true });
    this.recompute();
  }

  recompute(): void {
    if (!this._state.query) {
      this._state = { ...this._state, matches: [], activeIndex: -1 };
      this.notify();
      return;
    }

    const matches: SearchMatch[] = [];
    const blockOrder = this.editor.documentState.blockOrder;
    let globalIndex = 0;

    for (const blockId of blockOrder) {
      const handle = this.editor.getBlock(blockId);
      if (!handle) continue;

      const text = handle.textContent();
      const blockMatches = findMatchesInText(
        text,
        this._state.query,
        this._state.options,
        blockId,
        globalIndex,
      );

      for (const m of blockMatches) {
        m.index = globalIndex++;
      }

      matches.push(...blockMatches);
    }

    let activeIndex = this._state.activeIndex;
    if (activeIndex >= matches.length) activeIndex = matches.length - 1;
    if (activeIndex < 0 && matches.length > 0) activeIndex = 0;

    this._state = { ...this._state, matches, activeIndex };
    this.notify();
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private scrollToActiveMatch(): void {
    const match = this._state.matches[this._state.activeIndex];
    if (!match) return;
    this.editor.scrollToBlock?.(match.blockId);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}
```

**Replace-all uses descending offset order per block.** This avoids offset invalidation when multiple replacements occur in the same block.

---

## Module: `@pen/search — decorations.ts` — Search Highlight Decorations

```typescript
import type { InlineDecoration } from '@pen/types';
import type { SearchState } from './types.js';

export function buildSearchDecorations(state: SearchState): InlineDecoration[] {
  return state.matches.map((match, i) => ({
    type: 'inline' as const,
    blockId: match.blockId,
    from: match.from,
    to: match.to,
    attributes: {
      class: i === state.activeIndex
        ? 'pen-search-match pen-search-match-active'
        : 'pen-search-match',
      'data-match-index': String(match.index),
      'data-match-active': String(i === state.activeIndex),
    },
  }));
}
```

---

## Module: `@pen/search — extension.ts`

```typescript
import { defineExtension } from '@pen/types';
import { SearchEngine } from './engine.js';
import { buildSearchDecorations } from './decorations.js';

export const search = defineExtension({
  name: 'search',

  setup(editor) {
    const engine = new SearchEngine(editor);

    const unsubDoc = editor.onDocumentChange(() => {
      engine.recompute();
    });

    const unsubEngine = engine.onChange(() => {
      editor.requestDecorationUpdate();
    });

    return {
      decorations() {
        return buildSearchDecorations(engine.state);
      },

      expose: {
        engine,
        search: engine.setQuery.bind(engine),
        next: engine.next.bind(engine),
        previous: engine.previous.bind(engine),
        replace: engine.replace.bind(engine),
        replaceAll: engine.replaceAll.bind(engine),
        setOptions: engine.setOptions.bind(engine),
      },

      destroy() {
        unsubDoc();
        unsubEngine();
      },
    };
  },
});
```

---

## Search Primitives

### `Pen.Search.Root`

```typescript
interface SearchRootProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

// Data attributes:
// [data-pen-search-root]
// [data-open]
// [data-match-count]
// [data-has-matches]
```

### `Pen.Search.Input`

Search query field. Recomputes matches on change.

```typescript
interface SearchInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  asChild?: boolean;
}

// Data attributes:
// [data-pen-search-input]
```

### `Pen.Search.Results`

Displays match count: "3 of 12 matches" or "No matches".

```typescript
interface ResultsProps {
  children?: (state: { count: number; active: number }) => React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-search-results]
// [data-count]
// [data-active-index]
```

### `Pen.Search.Next` / `Pen.Search.Previous`

Navigation buttons. Wrap to start/end.

### `Pen.Search.Replace` / `Pen.Search.ReplaceAll`

Replace buttons. Disabled when no matches.

### `Pen.Search.CaseSensitive` / `Pen.Search.RegExp` / `Pen.Search.WholeWord`

Toggle buttons for search options.

```typescript
// Data attributes for all toggles:
// [data-pen-search-toggle]
// [data-active]
// [data-option]  - 'case-sensitive' | 'regex' | 'whole-word'
```

---

## Module: `@pen/input-rules — types.ts`

```typescript
import type { Editor, DocumentOp } from '@pen/types';

export interface InputRule {
  id: string;
  match: RegExp;
  handler: InputRuleHandler;
  blockTypes?: string[];
}

// Spec amendment: handler returns ops declaratively instead of calling editor.apply() imperatively.
// This is composable (testable without side effects) and lets the extension control application timing.
export type InputRuleHandler = (
  match: RegExpMatchArray,
  context: InputRuleContext,
) => DocumentOp[] | null;

export interface InputRuleContext {
  editor: Editor;
  blockId: string;
  blockType: string;
  textBefore: string;
  fullText: string;
}
```

---

## Module: `@pen/input-rules — engine.ts` — Rule Matching Engine

```typescript
import type { Editor, DocumentOp } from '@pen/types';
import type { InputRule, InputRuleContext } from './types.js';

export class InputRuleEngine {
  private rules: InputRule[] = [];

  register(rule: InputRule): void {
    const idx = this.rules.findIndex(r => r.id === rule.id);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
  }

  unregister(id: string): void {
    this.rules = this.rules.filter(r => r.id !== id);
  }

  tryMatch(
    editor: Editor,
    blockId: string,
    insertedText: string,
  ): DocumentOp[] | null {
    if (insertedText !== ' ' && insertedText !== '\n') return null;

    const handle = editor.getBlock(blockId);
    if (!handle) return null;

    const blockType = handle.type;
    const fullText = handle.textContent();

    const sel = editor.selection;
    const offset = sel?.type === 'text' ? sel.anchor.offset : fullText.length;

    // Build textBefore as it will be AFTER the pending insert is applied.
    // onBeforeApply fires before the CRDT mutation, so handle.textContent()
    // does not yet include the trigger character. We construct the
    // post-insertion text by splicing the inserted character at the offset.
    const textBefore = fullText.slice(0, offset) + insertedText;

    const ctx: InputRuleContext = {
      editor,
      blockId,
      blockType,
      textBefore,
      fullText,
    };

    for (const rule of this.rules) {
      if (rule.blockTypes && !rule.blockTypes.includes(blockType)) continue;

      const match = textBefore.match(rule.match);
      if (!match) continue;

      const ops = rule.handler(match, ctx);
      if (ops && ops.length > 0) return ops;
    }

    return null;
  }
}
```

**Trigger on space/newline.** Input rules only fire when the user types a space or newline. This prevents partial matches while the user is still typing a prefix.

---

## Module: `@pen/input-rules — default-rules.ts`

```typescript
import type { InputRule, InputRuleContext } from './types.js';
import type { DocumentOp } from '@pen/types';

export const defaultInputRules: InputRule[] = [
  headingRule(1, /^#\s$/),
  headingRule(2, /^##\s$/),
  headingRule(3, /^###\s$/),
  headingRule(4, /^####\s$/),
  headingRule(5, /^#####\s$/),
  headingRule(6, /^######\s$/),

  {
    id: 'input-rule:unordered-list',
    match: /^[-*]\s$/,
    blockTypes: ['paragraph'],
    handler: (match, ctx) => convertBlockOps(ctx, 'bulletListItem', match[0].length),
  },

  {
    id: 'input-rule:ordered-list',
    match: /^\d+\.\s$/,
    blockTypes: ['paragraph'],
    handler: (match, ctx) => convertBlockOps(ctx, 'numberedListItem', match[0].length),
  },

  {
    id: 'input-rule:check-list',
    match: /^\[[\sx]?\]\s$/i,
    blockTypes: ['paragraph'],
    handler: (match, ctx) => {
      const checked = match[0].toLowerCase().includes('x');
      return [
        { type: 'delete-text', blockId: ctx.blockId, offset: 0, length: match[0].length },
        {
          type: 'convert-block',
          blockId: ctx.blockId,
          newType: 'checkListItem',
          newProps: { checked },
        },
      ];
    },
  },

  {
    id: 'input-rule:blockquote',
    match: /^>\s$/,
    blockTypes: ['paragraph'],
    handler: (match, ctx) => convertBlockOps(ctx, 'blockquote', match[0].length),
  },

  {
    id: 'input-rule:code-block',
    match: /^```[\s\n]$/,
    blockTypes: ['paragraph'],
    handler: (match, ctx) => convertBlockOps(ctx, 'codeBlock', match[0].length),
  },

  {
    id: 'input-rule:divider',
    match: /^(?:---|\*\*\*|___)\s$/,
    blockTypes: ['paragraph'],
    handler: (match, ctx) => [
      { type: 'delete-text', blockId: ctx.blockId, offset: 0, length: match[0].length },
      { type: 'convert-block', blockId: ctx.blockId, newType: 'divider', newProps: {} },
    ],
  },

  {
    id: 'input-rule:callout',
    match: /^>\s*\[!(\w+)\]\s$/i,
    blockTypes: ['paragraph'],
    handler: (match, ctx) => {
      const calloutType = match[1].toLowerCase();
      return [
        { type: 'delete-text', blockId: ctx.blockId, offset: 0, length: match[0].length },
        {
          type: 'convert-block',
          blockId: ctx.blockId,
          newType: 'callout',
          newProps: { type: calloutType },
        },
      ];
    },
  },
];

function headingRule(level: number, match: RegExp): InputRule {
  return {
    id: `input-rule:heading-${level}`,
    match,
    blockTypes: ['paragraph'],
    handler: (m, ctx) => convertBlockOps(ctx, 'heading', m[0].length, { level }),
  };
}

function convertBlockOps(
  ctx: InputRuleContext,
  newType: string,
  deleteLength: number,
  newProps: Record<string, unknown> = {},
): DocumentOp[] {
  return [
    { type: 'delete-text', blockId: ctx.blockId, offset: 0, length: deleteLength },
    { type: 'convert-block', blockId: ctx.blockId, newType, newProps },
  ];
}
```

**9 default rules.** Heading 1-6, unordered list, ordered list, todo list, blockquote, code block, divider, callout. All only fire on `paragraph` blocks to prevent converting already-typed content.

---

## Module: `@pen/input-rules — extension.ts`

```typescript
import { defineExtension } from '@pen/types';
import { InputRuleEngine } from './engine.js';
import { defaultInputRules } from './default-rules.js';
import type { InputRule } from './types.js';

export interface InputRulesConfig {
  rules?: InputRule[];
  disableDefaults?: boolean;
}

export const inputRules = defineExtension<InputRulesConfig>({
  name: 'input-rules',

  setup(editor, config) {
    const engine = new InputRuleEngine();

    if (!config.disableDefaults) {
      for (const rule of defaultInputRules) {
        engine.register(rule);
      }
    }

    if (config.rules) {
      for (const rule of config.rules) {
        engine.register(rule);
      }
    }

    const unsub = editor.onBeforeApply((ops, options) => {
      if (options.origin === 'input-rule') return ops;
      if (options.origin === 'remote') return ops;

      for (const op of ops) {
        if (op.type !== 'insert-text') continue;
        if (op.text.length !== 1) continue;

        const result = engine.tryMatch(editor, op.blockId, op.text);
        if (result) {
          queueMicrotask(() => {
            editor.apply(result, { origin: 'input-rule', undoGroup: true });
          });
        }
      }

      return ops;
    });

    return {
      expose: {
        register: engine.register.bind(engine),
        unregister: engine.unregister.bind(engine),
      },

      destroy() {
        unsub();
      },
    };
  },
});
```

**Fires via `onBeforeApply` hook.** Intercepts single-character text insertions (space or newline). If a rule matches, the conversion ops are queued as a microtask so they execute after the insertion completes. The conversion ops are their own undo group so Ctrl+Z reverts the auto-format without losing the typed character.

---

## Suggestion-Aware Export

### Markdown Export (`@pen/export-markdown` update)

When exporting a document that contains `suggestion` system marks, the markdown exporter uses **CriticMarkup** notation:

| Suggestion action | CriticMarkup syntax |
|---|---|
| `insert` | `{++inserted text++}` |
| `delete` | `{--deleted text--}` |
| `insert` + `delete` (replacement) | `{~~old text~>new text~~}` |

```typescript
function serializeInlineWithSuggestions(
  delta: any[],
  markSerializers: Map<string, MarkSerializer>,
): string {
  let result = '';

  for (const op of delta) {
    if (typeof op.insert !== 'string') continue;

    const suggestion = op.attributes?.suggestion;
    let text = serializeMarks(op.insert, op.attributes, markSerializers);

    if (suggestion) {
      if (suggestion.action === 'insert') {
        text = `{++${text}++}`;
      } else if (suggestion.action === 'delete') {
        text = `{--${text}--}`;
      }
    }

    result += text;
  }

  return result;
}
```

**Block-level suggestions** are exported as a comment preceding the block:

```markdown
<!-- suggestion: insert-block by ai (model: gpt-4) -->
New paragraph text here.
```

### HTML Export (`@pen/export-html` update)

Uses `<ins>` and `<del>` elements with data attributes:

```typescript
function wrapWithSuggestionTag(
  html: string,
  suggestion: Record<string, unknown>,
): string {
  const tag = suggestion.action === 'insert' ? 'ins' : 'del';
  const htmlAttributes = [
    `data-suggestion-id="${suggestion.id}"`,
    `data-author-type="${suggestion.authorType}"`,
  ];
  if (suggestion.model) htmlAttributes.push(`data-model="${suggestion.model}"`);
  return `<${tag} ${htmlAttributes.join(' ')}>${html}</${tag}>`;
}
```

---

## Module: `@pen/cli`

### `commands/create.ts` — Project Scaffolding

```typescript
import { scaffold } from '../scaffold.js';
import { prompt } from '../prompts.js';
import { getTemplate } from '../templates/registry.js';
import { detectPackageManager, runInstall } from '../package-manager.js';

export async function create(args: string[]): Promise<void> {
  const projectName = args[0] ?? await prompt.text('Project name:');
  const templateName = args[1] ?? await prompt.select('Template:', [
    { value: 'minimal', label: 'Minimal — Editor with basic extensions' },
    { value: 'full', label: 'Full — Editor with all extensions and collaboration' },
  ]);

  const options = await prompt.multiSelect('Features:', [
    { value: 'ai', label: 'AI extension (@pen/ai)', selected: true },
    { value: 'collab', label: 'Collaboration (@pen/collab)', selected: templateName === 'full' },
    { value: 'history', label: 'Version history (@pen/history)', selected: templateName === 'full' },
    { value: 'search', label: 'Search (@pen/search)', selected: true },
    { value: 'input-rules', label: 'Input rules (@pen/input-rules)', selected: true },
    { value: 'markdown', label: 'Markdown import/export', selected: true },
  ]);

  const framework = await prompt.select('Framework:', [
    { value: 'react', label: 'React' },
    { value: 'next', label: 'Next.js' },
    { value: 'vite', label: 'Vite + React' },
  ]);

  const template = getTemplate(templateName);
  const targetDir = `./${projectName}`;

  await scaffold({
    targetDir,
    template,
    projectName,
    features: options,
    framework,
  });

  const pm = detectPackageManager();
  const shouldInstall = await prompt.confirm(`Install dependencies with ${pm}?`);

  if (shouldInstall) {
    await runInstall(pm, targetDir);
  }

  console.log(`\n  Project "${projectName}" created at ${targetDir}\n`);
  console.log(`  cd ${projectName}`);
  console.log(`  ${pm} run dev\n`);
}
```

### `scaffold.ts` — File Generation

```typescript
export interface ScaffoldOptions {
  targetDir: string;
  template: Template;
  projectName: string;
  features: string[];
  framework: string;
}

export interface Template {
  name: string;
  files: TemplateFile[];
}

export interface TemplateFile {
  path: string;
  content: string | ((opts: ScaffoldOptions) => string);
  condition?: (opts: ScaffoldOptions) => boolean;
}

export async function scaffold(opts: ScaffoldOptions): Promise<void> {
  const { targetDir, template } = opts;

  for (const file of template.files) {
    if (file.condition && !file.condition(opts)) continue;

    const content = typeof file.content === 'function'
      ? file.content(opts)
      : file.content;

    const fullPath = `${targetDir}/${file.path}`;
    const dir = fullPath.slice(0, fullPath.lastIndexOf('/'));

    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content, 'utf-8');
  }
}
```

### `templates/minimal.ts` — Minimal Template

Generates:

- `package.json` with selected `@pen/*` dependencies
- `tsconfig.json`
- `src/editor.tsx` — Editor component with selected extensions
- `src/App.tsx` — App shell
- `src/main.tsx` — Entry point
- `index.html`
- `vite.config.ts` (if Vite)
- `next.config.ts` (if Next.js)

### `templates/full.ts` — Full Template

Everything in minimal, plus:

- `src/collab-provider.tsx` — WebSocket collaboration setup
- `src/history-panel.tsx` — Version history sidebar
- `src/ai-commands.tsx` — Custom AI commands
- `src/toolbar.tsx` — Formatting toolbar
- `docker-compose.yml` — y-websocket server for collab

### `package-manager.ts` — Package Manager Detection

```typescript
import { existsSync } from 'node:fs';

export type PackageManager = 'pnpm' | 'npm' | 'yarn' | 'bun';

export function detectPackageManager(): PackageManager {
  const userAgent = process.env.npm_config_user_agent ?? '';
  if (userAgent.startsWith('pnpm')) return 'pnpm';
  if (userAgent.startsWith('yarn')) return 'yarn';
  if (userAgent.startsWith('bun')) return 'bun';
  if (existsSync('pnpm-lock.yaml')) return 'pnpm';
  if (existsSync('yarn.lock')) return 'yarn';
  if (existsSync('bun.lockb')) return 'bun';
  return 'npm';
}

export async function runInstall(pm: PackageManager, cwd: string): Promise<void> {
  const { execSync } = await import('node:child_process');
  execSync(`${pm} install`, { cwd, stdio: 'inherit' });
}
```

### CLI Entry Point

```typescript
#!/usr/bin/env node

import { create } from './commands/create.js';
import { help } from './commands/help.js';

const [command, ...args] = process.argv.slice(2);

switch (command) {
  case 'create':
    await create(args);
    break;
  case 'help':
  case '--help':
  case '-h':
  case undefined:
    help();
    break;
  default:
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(1);
}
```

---

## Dependencies

### `@pen/search`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@pen/react": "workspace:*",
    "react": "^19.0.0"
  }
}
```

### `@pen/input-rules`

```json
{
  "dependencies": {
    "@pen/types": "workspace:*"
  }
}
```

### `@pen/cli`

```json
{
  "bin": {
    "pen": "./dist/index.js"
  },
  "dependencies": {
    "@clack/prompts": "^0.8.0"
  }
}
```

Uses `@clack/prompts` for interactive CLI prompts (beautiful, minimal dependency, spinner support).

---

## Key Decisions

1. **Search recomputes on every document change (debounced).** The search engine listens to `onDocumentChange` and re-runs the query. Recomputation is debounced with a 100ms trailing delay to avoid thrashing during rapid typing. For M1 this is fine — with 10k blocks, linear scan over text content takes <5ms. The debounce interval is configurable via `SearchOptions.debounceMs`.

2. **Replace-all uses descending offset order per block.** Same pattern as track-changes accept: prevents offset invalidation.

3. **Input rules fire on `onBeforeApply` with microtask queueing.** The rule's conversion ops execute after the triggering insertion completes. This ensures the rule sees the final text content (including the space/newline) before attempting to match.

4. **Input rules use `origin: 'input-rule'` to prevent re-triggering.** Without this, a rule that inserts text could recursively trigger other rules.

5. **CriticMarkup for Markdown export.** This is the spec's chosen format for suggestion marks in Markdown. It's a well-known standard that tools like Pandoc understand.

6. **`<ins>` / `<del>` for HTML export.** Semantic HTML elements for suggestions. `data-*` attributes carry suggestion metadata.

7. **CLI uses `@clack/prompts`.** Beautiful terminal UI. Small dependency. Spinner for install step.

8. **Template files use conditional generation.** Each template file can have a `condition` function — if the user didn't select "ai", the AI-related files are skipped.

---

## Acceptance Criteria

1. Search finds all occurrences of a text query across all blocks.
2. Case-sensitive, regex, and whole-word toggles modify search behavior.
3. Invalid regex patterns fall back to literal matching.
4. `Pen.Search.Next` / `Previous` cycle through matches with wrap-around.
5. Active match is highlighted differently from other matches (`pen-search-match-active`).
6. Replace replaces the active match and advances to the next.
7. Replace All replaces all matches in a single undo group.
8. Search decorations update when the document changes.
9. Typing `# ` at the start of a paragraph converts it to a heading level 1.
10. Typing `- ` converts to unordered list, `1. ` to ordered list, `> ` to blockquote.
11. Typing `` ``` `` converts to code block, `---` to divider.
12. Typing `[x] ` converts to checked todo, `[ ] ` to unchecked todo.
13. Input rules only fire on paragraph blocks (by default).
14. Ctrl+Z after an input rule reverts the conversion but keeps the typed text.
15. Custom input rules can be registered and override defaults.
16. Input rules don't fire on remote operations.
17. Markdown export uses CriticMarkup for suggestion marks (`{++insert++}`, `{--delete--}`).
18. HTML export uses `<ins>` / `<del>` elements for suggestion marks.
19. Block-level suggestions are exported as HTML comments (Markdown) or data attributes (HTML).
20. `pen create` prompts for project name, template, features, and framework.
21. `pen create` generates correct `package.json` with selected `@pen/*` dependencies.
22. `pen create` detects package manager and offers to install.
23. Generated project builds and runs with `npm run dev` / `pnpm dev`.
24. All search primitives support `asChild`, forward refs, render no styles, and expose `data-*` attributes.
