# Wave 12 — Production & Ecosystem

**Milestone:** M3 · **Packages:** `@pen/export-json`, `@pen/export-xml`, `@pen/auth`, `@pen/sync-electricsql`, `@pen/crdt-loro`, `@pen/vue`, `@pen/svelte`, `@pen/docs` · **Depends on:** M2 (Waves 0-11)

---

## Goal

Production readiness. Ship the full export suite, authentication/authorization layer, ElectricSQL sync provider, alternative Loro CRDT adapter, Vue and Svelte renderers, CLI extension system, and the documentation site. After this wave, Pen is a complete, production-grade editor engine with multi-framework support, pluggable persistence, and comprehensive docs.

---

## File Structure

### `@pen/export-json`

```
packages/exporters/json/src/
├── index.ts                Package entry
├── exporter.ts             JSON export (full document → JSON AST)
├── importer.ts             JSON import (JSON AST → DocumentOps)
├── schema.ts               JSON schema definition for the export format
└── types.ts                Export types
```

### `@pen/export-xml`

```
packages/exporters/xml/src/
├── index.ts                Package entry
├── exporter.ts             XML export (document → XML)
├── importer.ts             XML import (XML → DocumentOps)
├── serializer.ts           Block/inline → XML element serializer
└── types.ts                Export types
```

### `@pen/auth`

```
packages/auth/src/
├── index.ts                Package entry
├── types.ts                Auth types (Role, Permission, Policy)
├── policy/
│   ├── engine.ts           Policy evaluation engine
│   ├── default-policies.ts Default role-based policies
│   └── builder.ts          Fluent policy builder API
├── middleware/
│   ├── editor-guard.ts     Editor operation guard (pre-apply check)
│   ├── transport-guard.ts  Transport-level auth (token validation)
│   └── api-guard.ts        REST/SSE endpoint guard
├── providers/
│   ├── jwt.ts              JWT token validation
│   ├── session.ts          Session-based auth
│   └── custom.ts           Custom auth provider interface
├── primitives/
│   ├── auth-provider.tsx   Pen.Auth.Provider — context
│   ├── require-role.tsx    Pen.Auth.RequireRole — conditional render
│   └── index.ts            Barrel
├── hooks/
│   ├── use-auth.ts         useAuth() — current user, role, permissions
│   └── index.ts            Barrel
└── extension.ts            defineExtension — entry point
```

### `@pen/sync-electricsql`

```
packages/sync/electricsql/src/
├── index.ts                Package entry
├── provider.ts             ElectricSQL sync provider (PenPersistence impl)
├── schema.ts               ElectricSQL table schema
├── shapes.ts               Shape subscriptions for document data
├── conflict-resolver.ts    CRDT update conflict handling
└── types.ts                Sync types
```

### `@pen/crdt-loro`

```
packages/crdt/loro/src/
├── index.ts                Package entry
├── adapter.ts              CRDTAdapter implementation for Loro
├── document.ts             Loro document management
├── event-translator.ts     Loro events → CRDTEvent translation
├── undo-manager.ts         UndoManager using Loro primitives
├── awareness.ts            Awareness protocol (Loro-native or compatible)
├── snapshot.ts             Snapshot/fork/merge using Loro
└── types.ts                Loro-specific types
```

### `@pen/vue`

```
packages/renderers/vue/src/
├── index.ts                Package entry
├── composables/
│   ├── use-editor.ts       useEditor() composable
│   ├── use-selection.ts    useSelection() composable
│   ├── use-block-list.ts   useBlockList() composable
│   ├── use-decorations.ts  useDecorations() composable
│   ├── use-toolbar.ts      useToolbar() composable
│   └── index.ts            Barrel
├── components/
│   ├── PenEditor.vue       Root editor component
│   ├── PenContent.vue      Block list renderer
│   ├── PenBlock.vue        Block wrapper
│   ├── PenInlineContent.vue  Inline content renderer
│   ├── PenFieldEditor.vue  Field editor (ContentEditable backend)
│   ├── PenToolbar.vue      Formatting toolbar
│   └── index.ts            Barrel
├── plugin.ts               Vue plugin (app.use(PenPlugin))
└── types.ts                Vue-specific types
```

### `@pen/svelte`

```
packages/renderers/svelte/src/
├── index.ts                Package entry
├── stores/
│   ├── editor.ts           editor store (Svelte writable)
│   ├── selection.ts        selection store
│   ├── block-list.ts       blockList store
│   ├── decorations.ts      decorations store
│   └── index.ts            Barrel
├── components/
│   ├── PenEditor.svelte    Root editor component
│   ├── PenContent.svelte   Block list renderer
│   ├── PenBlock.svelte     Block wrapper
│   ├── PenInlineContent.svelte  Inline content renderer
│   ├── PenFieldEditor.svelte    Field editor
│   ├── PenToolbar.svelte   Formatting toolbar
│   └── index.ts            Barrel
├── action.ts               use:pen action for field editors
└── types.ts                Svelte-specific types
```

### `@pen/docs`

```
packages/docs/
├── package.json
├── next.config.ts          Next.js config (or Starlight/Astro)
├── content/
│   ├── getting-started/
│   │   ├── introduction.mdx
│   │   ├── installation.mdx
│   │   ├── quick-start.mdx
│   │   └── concepts.mdx
│   ├── guides/
│   │   ├── custom-blocks.mdx
│   │   ├── custom-marks.mdx
│   │   ├── extensions.mdx
│   │   ├── ai-integration.mdx
│   │   ├── collaboration.mdx
│   │   ├── layout.mdx
│   │   ├── apps.mdx
│   │   └── theming.mdx
│   ├── api-reference/
│   │   ├── core.mdx
│   │   ├── react.mdx
│   │   ├── crdt-yjs.mdx
│   │   ├── ai.mdx
│   │   ├── collab.mdx
│   │   ├── history.mdx
│   │   ├── search.mdx
│   │   ├── input-rules.mdx
│   │   ├── layout.mdx
│   │   ├── apps.mdx
│   │   ├── execution.mdx
│   │   ├── skills.mdx
│   │   ├── branch.mdx
│   │   ├── transports.mdx
│   │   ├── importers.mdx
│   │   ├── exporters.mdx
│   │   ├── mcp.mdx
│   │   └── auth.mdx
│   ├── architecture/
│   │   ├── overview.mdx
│   │   ├── crdt-abstraction.mdx
│   │   ├── operation-pipeline.mdx
│   │   ├── extension-system.mdx
│   │   └── schema-engine.mdx
│   └── examples/
│       ├── minimal-editor.mdx
│       ├── collaborative-editor.mdx
│       ├── ai-writing-assistant.mdx
│       ├── notion-clone.mdx
│       └── email-builder.mdx
├── components/
│   ├── LiveEditor.tsx      Interactive editor playground
│   ├── APITable.tsx         Auto-generated API tables
│   └── CodeBlock.tsx        Syntax-highlighted code blocks
└── public/
```

### Import DAG (Cross-Package)

```
@pen/export-json:    ← (@pen/core)
@pen/export-xml:     ← (@pen/core)
@pen/auth:           ← (@pen/core), (@pen/react)
@pen/sync-electricsql: ← (@pen/core)
@pen/crdt-loro:      ← (@pen/core)
@pen/vue:            ← (@pen/core)
@pen/svelte:         ← (@pen/core)
```

All packages depend on `@pen/core` as their base. Some packages add required runtime/framework dependencies (`@pen/auth` also depends on `@pen/react`; framework renderers depend on their framework runtime). No circular dependencies between M3 packages.

---

## Module: `@pen/export-json — exporter.ts`

Full-fidelity JSON export. Preserves block structure, inline marks, metadata, and app data. Designed as the canonical serialization format for persistence.

```typescript
import type { Editor, BlockHandle } from '@pen/types';

export interface PenDocumentJSON {
  version: 1;
  schema: string;
  blockOrder: string[];
  blocks: Record<string, BlockJSON>;
  metadata?: Record<string, unknown>;
}

export interface BlockJSON {
  id: string;
  type: string;
  props: Record<string, unknown>;
  content: InlineContentJSON[];
  children?: string[];
  meta?: Record<string, unknown>;
}

export interface InlineContentJSON {
  type: 'text' | 'inline-node';
  text?: string;
  marks?: Record<string, unknown>[];
  nodeType?: string;
  props?: Record<string, unknown>;
}

export function exportToJSON(editor: Editor): PenDocumentJSON {
  const blockOrder = [...editor.documentState.blockOrder];
  const blocks: Record<string, BlockJSON> = {};

  function visitBlock(blockId: string): void {
    if (blocks[blockId]) return;
    const handle = editor.getBlock(blockId);
    if (!handle) return;

    const childIds = (handle.props.children as string[]) ?? undefined;
    blocks[blockId] = {
      id: blockId,
      type: handle.type,
      props: cleanProps(handle.props),
      content: serializeContent(editor, handle),
      children: childIds,
      meta: handle.hasMeta?.() ? handle.allMeta?.() : undefined,
    };

    if (childIds) {
      for (const childId of childIds) visitBlock(childId);
    }
  }

  for (const blockId of blockOrder) {
    visitBlock(blockId);
  }

  return {
    version: 1,
    schema: 'pen-document',
    blockOrder,
    blocks,
    metadata: editor.documentState.metadata ?? undefined,
  };
}

function serializeContent(editor: Editor, handle: BlockHandle): InlineContentJSON[] {
  const doc = editor.internals.doc;
  const blockMap = (doc.blocks as Map<string, unknown>).get(handle.id) as { get(key: string): unknown } | undefined;
  const ytext = blockMap?.get('content') ?? null;
  if (!ytext) {
    const text = handle.textContent();
    return text ? [{ type: 'text', text }] : [];
  }

  const deltas = ytext.toDelta();
  return deltas.map((delta: any) => {
    if (typeof delta.insert === 'string') {
      const marks = delta.attributes
        ? Object.entries(delta.attributes)
            .filter(([key]) => key !== 'suggestion')
            .map(([key, value]) => ({ [key]: value }))
        : undefined;

      return {
        type: 'text' as const,
        text: delta.insert,
        marks: marks?.length ? marks : undefined,
      };
    }

    return {
      type: 'inline-node' as const,
      nodeType: delta.insert?.type ?? 'unknown',
      props: delta.insert?.props ?? {},
    };
  });
}

function cleanProps(props: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    cleaned[key] = value;
  }
  return cleaned;
}
```

> **CRDT abstraction.** The JSON exporter/importer must use `BlockHandle.textDeltas()` and `BlockHandle.props` instead of raw CRDT type access. The code examples show direct Yjs access for clarity; the implementation MUST go through the handle API to ensure compatibility with alternative CRDT adapters.

---

## Module: `@pen/export-json — importer.ts`

```typescript
import type { Editor, DocumentOp } from '@pen/types';
import type { PenDocumentJSON, BlockJSON } from './exporter.js';

type DocumentMigrator = (input: PenDocumentJSON) => PenDocumentJSON;

const MIGRATORS: Record<number, DocumentMigrator> = {
  1: (doc) => doc,
};

export function importFromJSON(
  editor: Editor,
  doc: PenDocumentJSON,
): void {
  if (doc.version < 1) {
    throw new Error(`Unsupported document version: ${doc.version}`);
  }

  const migrate = MIGRATORS[doc.version];
  if (!migrate) {
    throw new Error(`No migrator registered for document version: ${doc.version}`);
  }
  const migrated = migrate(doc);

  const ops: DocumentOp[] = [];

  for (const blockId of migrated.blockOrder) {
    const block = migrated.blocks[blockId];
    if (!block) continue;

    ops.push({
      type: 'insert-block',
      blockId: block.id,
      blockType: block.type,
      props: block.props,
    });

    const text = block.content
      .filter(c => c.type === 'text' && c.text)
      .map(c => c.text!)
      .join('');

    if (text) {
      ops.push({
        type: 'insert-text',
        blockId: block.id,
        offset: 0,
        text,
      });
    }

    let offset = 0;
    for (const content of block.content) {
      if (content.type === 'text' && content.text && content.marks?.length) {
        for (const mark of content.marks) {
          const [markType, markValue] = Object.entries(mark)[0];
          ops.push({
            type: 'format-text',
            blockId: block.id,
            offset,
            length: content.text.length,
            marks: { [markType]: markValue },
          });
        }
        offset += content.text.length;
      } else if (content.type === 'text' && content.text) {
        offset += content.text.length;
      }
    }
  }

  editor.apply(ops, { origin: 'import', undoGroup: true });
}
```

Migration/deprecation policy: readers support the current format and at least one prior format through explicit migrators. Unsupported versions fail deterministically with actionable diagnostics.

---

## Module: `@pen/export-xml — exporter.ts`

```typescript
import type { Editor, BlockHandle } from '@pen/types';

export interface XMLExportOptions {
  indent?: boolean;
  encoding?: string;
  rootElement?: string;
}

export function exportToXML(
  editor: Editor,
  options: XMLExportOptions = {},
): string {
  const indent = options.indent ?? true;
  const encoding = options.encoding ?? 'utf-8';
  const rootElement = options.rootElement ?? 'pen-document';

  let xml = `<?xml version="1.0" encoding="${encoding}"?>\n`;
  xml += `<${rootElement} version="1">\n`;

  const blockOrder = editor.documentState.blockOrder;
  for (const blockId of blockOrder) {
    const handle = editor.getBlock(blockId);
    if (!handle) continue;
    xml += serializeBlockToXML(handle, indent ? 1 : 0);
  }

  xml += `</${rootElement}>\n`;
  return xml;
}

function serializeBlockToXML(handle: BlockHandle, indentLevel: number): string {
  const indent = '  '.repeat(indentLevel);
  const type = handle.type;
  const props = handle.props;

  const propsAttr = Object.entries(props)
    .filter(([key]) => key !== 'children')
    .map(([key, value]) => {
      const strValue = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `${key}="${escapeXML(strValue)}"`;
    })
    .join(' ');

  const openTag = propsAttr
    ? `${indent}<block type="${type}" id="${handle.id}" ${propsAttr}>`
    : `${indent}<block type="${type}" id="${handle.id}">`;

  const text = handle.textContent();
  const children = (props.children as string[]) ?? [];

  if (!text && children.length === 0) {
    return `${openTag}</block>\n`;
  }

  let content = `${openTag}\n`;

  if (text) {
    content += `${indent}  <content>${escapeXML(text)}</content>\n`;
  }

  content += `${indent}</block>\n`;
  return content;
}

function escapeXML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
```

---

## Module: `@pen/auth — types.ts`

```typescript
import type { DocumentOp } from '@pen/types';

export type Role = 'owner' | 'admin' | 'editor' | 'commenter' | 'viewer' | 'anonymous';

export type Permission =
  | 'document:read'
  | 'document:write'
  | 'document:delete'
  | 'document:share'
  | 'block:insert'
  | 'block:delete'
  | 'block:update'
  | 'block:move'
  | 'text:insert'
  | 'text:delete'
  | 'text:format'
  | 'comment:create'
  | 'comment:delete'
  | 'suggestion:create'
  | 'suggestion:accept'
  | 'suggestion:reject'
  | 'app:install'
  | 'app:configure'
  | 'execution:run'
  | 'history:restore'
  | 'branch:create'
  | 'branch:merge';

export interface AuthUser {
  id: string;
  name: string;
  email?: string;
  role: Role;
  avatar?: string;
  metadata?: Record<string, unknown>;
}

export interface AuthPolicy {
  role: Role;
  permissions: Permission[];
  conditions?: PolicyCondition[];
}

export interface PolicyCondition {
  type: 'block-type' | 'block-owner' | 'time-window' | 'custom';
  check: (ctx: PolicyContext) => boolean;
}

export interface PolicyContext {
  user: AuthUser;
  op: DocumentOp | null;
  blockId?: string;
  blockType?: string;
  blockOwnerId?: string;
}

export interface AuthProvider {
  validateToken(token: string): Promise<AuthUser | null>;
  refreshToken?(token: string): Promise<string | null>;
}
```

---

## Module: `@pen/auth — policy/engine.ts` — Policy Evaluation

```typescript
import type { AuthUser, AuthPolicy, Permission, PolicyContext, DocumentOp } from '../types.js';

export class PolicyEngine {
  private policies: AuthPolicy[] = [];

  addPolicy(policy: AuthPolicy): void {
    this.policies.push(policy);
  }

  removePolicy(role: Role): void {
    this.policies = this.policies.filter(p => p.role !== role);
  }

  check(user: AuthUser, permission: Permission, ctx?: Partial<PolicyContext>): boolean {
    const policy = this.policies.find(p => p.role === user.role);
    if (!policy) return false;

    if (!policy.permissions.includes(permission)) return false;

    if (policy.conditions) {
      const fullCtx: PolicyContext = {
        user,
        op: ctx?.op ?? null,
        blockId: ctx?.blockId,
        blockType: ctx?.blockType,
        blockOwnerId: ctx?.blockOwnerId,
      };

      for (const condition of policy.conditions) {
        if (!condition.check(fullCtx)) return false;
      }
    }

    return true;
  }

  checkOp(user: AuthUser, op: DocumentOp): boolean {
    const permission = opToPermission(op);
    if (!permission) return true;
    return this.check(user, permission, { op });
  }
}

function opToPermission(op: DocumentOp): Permission | null {
  switch (op.type) {
    case 'insert-block': return 'block:insert';
    case 'delete-block': return 'block:delete';
    case 'update-block': return 'block:update';
    case 'move-block': return 'block:move';
    case 'convert-block': return 'block:update';
    case 'insert-text': return 'text:insert';
    case 'delete-text': return 'text:delete';
    case 'format-text': return 'text:format';
    case 'replace-text': return 'text:insert';
    case 'insert-inline-node': return 'text:insert';
    case 'remove-inline-node': return 'text:delete';
    case 'insert-table-row': return 'block:update';
    case 'delete-table-row': return 'block:update';
    case 'insert-table-column': return 'block:update';
    case 'delete-table-column': return 'block:update';
    case 'merge-table-cells': return 'block:update';
    case 'split-table-cell': return 'block:update';
    case 'set-meta': return 'block:update';
    case 'set-selection': return null;
    case 'create-app': return 'block:insert';
    case 'delete-app': return 'block:delete';
    case 'update-app': return 'block:update';
    default: return null;
  }
}

import type { Role } from '../types.js';
```

---

## Module: `@pen/auth — policy/default-policies.ts`

```typescript
import type { AuthPolicy } from '../types.js';

export const defaultPolicies: AuthPolicy[] = [
  {
    role: 'owner',
    permissions: [
      'document:read', 'document:write', 'document:delete', 'document:share',
      'block:insert', 'block:delete', 'block:update', 'block:move',
      'text:insert', 'text:delete', 'text:format',
      'comment:create', 'comment:delete',
      'suggestion:create', 'suggestion:accept', 'suggestion:reject',
      'app:install', 'app:configure',
      'execution:run',
      'history:restore',
      'branch:create', 'branch:merge',
    ],
  },
  {
    role: 'admin',
    permissions: [
      'document:read', 'document:write', 'document:share',
      'block:insert', 'block:delete', 'block:update', 'block:move',
      'text:insert', 'text:delete', 'text:format',
      'comment:create', 'comment:delete',
      'suggestion:create', 'suggestion:accept', 'suggestion:reject',
      'app:install', 'app:configure',
      'execution:run',
      'history:restore',
      'branch:create', 'branch:merge',
    ],
  },
  {
    role: 'editor',
    permissions: [
      'document:read', 'document:write',
      'block:insert', 'block:delete', 'block:update', 'block:move',
      'text:insert', 'text:delete', 'text:format',
      'comment:create',
      'suggestion:create',
      'branch:create',
    ],
  },
  {
    role: 'commenter',
    permissions: [
      'document:read',
      'comment:create',
      'suggestion:create',
    ],
  },
  {
    role: 'viewer',
    permissions: [
      'document:read',
    ],
  },
  {
    role: 'anonymous',
    permissions: [],
  },
];
```

---

## Module: `@pen/auth — middleware/editor-guard.ts`

Intercepts `editor.apply()` and rejects unauthorized operations.

```typescript
import type { Editor, DocumentOp, Unsubscribe } from '@pen/types';
import type { AuthUser } from '../types.js';
import { PolicyEngine } from '../policy/engine.js';

export function createEditorGuard(
  editor: Editor,
  policyEngine: PolicyEngine,
  getUser: () => AuthUser | null,
  trustedOrigins: readonly string[] = ['system'],
): Unsubscribe {
  return editor.onBeforeApply((ops, options) => {
    if (trustedOrigins.includes(options.origin)) return ops;

    const user = getUser();
    if (!user) return [];

    const allowed = ops.filter(op => policyEngine.checkOp(user, op));

    if (allowed.length < ops.length) {
      const denied = ops.length - allowed.length;
      console.warn(`[pen/auth] Denied ${denied} operations for role "${user.role}"`);
    }

    return allowed;
  });
}
```

**Operation-level filtering with auditability.** Each op in a batch is individually checked. Allowed ops pass through; denied ops are dropped and surfaced through diagnostics/audit events (not silent). This means a batch can be partially applied if some ops are authorized and others are not.

---

## Module: `@pen/auth — providers/jwt.ts`

```typescript
import type { AuthProvider, AuthUser, Role } from '../types.js';

export interface JWTProviderOptions {
  secret?: string;
  publicKey?: string;
  issuer?: string;
  audience?: string;
  roleField?: string;
  verify?: (token: string) => Promise<Record<string, any> | null>;
}

export class JWTProvider implements AuthProvider {
  private options: JWTProviderOptions;

  constructor(options: JWTProviderOptions) {
    this.options = options;
  }

  async validateToken(token: string): Promise<AuthUser | null> {
    try {
      const payload = await verifyJWT(token, this.options);
      if (!payload) return null;

      const roleField = this.options.roleField ?? 'role';
      return {
        id: payload.sub ?? payload.id,
        name: payload.name ?? payload.email ?? 'Unknown',
        email: payload.email,
        role: (payload[roleField] ?? 'viewer') as Role,
        metadata: payload,
      };
    } catch {
      return null;
    }
  }
}

async function verifyJWT(
  token: string,
  options: JWTProviderOptions,
): Promise<Record<string, any> | null> {
  if (options.verify) {
    return options.verify(token);
  }

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const payload = JSON.parse(
    typeof atob === 'function'
      ? atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))
      : Buffer.from(parts[1], 'base64url').toString('utf-8'),
  );

  if (options.issuer && payload.iss !== options.issuer) return null;
  if (options.audience && payload.aud !== options.audience) return null;
  if (payload.exp && payload.exp * 1000 < Date.now()) return null;

  return payload;
}
```

**JWT validation baseline.** Signature verification is required for production. This reference provider supports a pluggable `verify()` callback (for `jose`, Auth0 SDKs, Cognito, etc.) and then applies claim checks (`iss`, `aud`, `exp`) consistently. Claim-only parsing is for local development/testing only.

---

## Auth Extension Entry Point

```typescript
import { defineExtension } from '@pen/types';
import type { AuthProvider, AuthUser } from './types.js';
import { PolicyEngine } from './policy/engine.js';
import { defaultPolicies } from './policy/default-policies.js';
import { createEditorGuard } from './middleware/editor-guard.js';

export interface AuthConfig {
  provider: AuthProvider;
  user: AuthUser;
  policies?: AuthPolicy[];
}

export const auth = defineExtension<AuthConfig>({
  name: 'auth',

  setup(editor, config) {
    const engine = new PolicyEngine();
    for (const policy of config.policies ?? defaultPolicies) {
      engine.addPolicy(policy);
    }

    let currentUser: AuthUser | null = config.user;

    const unsub = createEditorGuard(editor, engine, () => currentUser);

    return {
      expose: {
        engine,
        setUser(user: AuthUser | null) { currentUser = user; },
        getUser() { return currentUser; },
        check(permission: Permission) {
          if (!currentUser) return false;
          return engine.check(currentUser, permission);
        },
      },
      destroy() { unsub(); },
    };
  },
});
```

---

## Module: `@pen/sync-electricsql — provider.ts`

ElectricSQL sync provider. Implements `PenPersistence` to store and load document state via ElectricSQL's synced local-first database.

```typescript
import type { PenPersistence, CRDTDocument } from '@pen/types';
import type { ElectricSyncOptions, ShapeSubscription } from './types.js';

export class ElectricSQLProvider implements PenPersistence {
  private electric: any;
  private docTable: string;
  private updateTable: string;
  private versionTable: string;

  constructor(electric: any, options: ElectricSyncOptions = {}) {
    this.electric = electric;
    this.docTable = options.tableName ?? 'pen_documents';
    this.updateTable = options.updateTableName ?? 'pen_updates';
    this.versionTable = options.versionTableName ?? 'pen_versions';
  }

  async loadDocument(docId: string): Promise<Uint8Array | null> {
    const row = await this.electric.db[this.docTable].findUnique({
      where: { id: docId },
    });
    if (!row?.snapshot) return null;
    return new Uint8Array(row.snapshot);
  }

  async saveSnapshot(docId: string, state: Uint8Array): Promise<void> {
    await this.electric.db[this.docTable].upsert({
      create: { id: docId, snapshot: Buffer.from(state), updatedAt: new Date() },
      update: { snapshot: Buffer.from(state), updatedAt: new Date() },
      where: { id: docId },
    });
  }

  async appendUpdate(docId: string, update: Uint8Array): Promise<void> {
    await this.electric.db[this.updateTable].create({
      data: {
        id: crypto.randomUUID(),
        docId,
        data: Buffer.from(update),
        createdAt: new Date(),
      },
    });
  }

  async getUpdates(docId: string, since?: Uint8Array): Promise<Uint8Array[]> {
    const rows = await this.electric.db[this.updateTable].findMany({
      where: { docId },
      orderBy: { createdAt: 'asc' },
    });
    const updates = rows.map((r: any) => ({
      id: r.id as string,
      data: new Uint8Array(r.data),
    }));

    if (!since) return updates.map((r) => r.data);

    const sinceId = new TextDecoder().decode(since);
    const index = updates.findIndex((r) => r.id === sinceId);
    if (index < 0) return updates.map((r) => r.data);
    return updates.slice(index + 1).map((r) => r.data);
  }

  async compact(docId: string): Promise<void> {
    const updates = await this.getUpdates(docId);
    if (updates.length <= 1) return;
    // Merge all updates into the snapshot, then delete update rows
    const current = await this.loadDocument(docId);
    // Actual merging is done by the caller via CRDTAdapter.mergeUpdates
    await this.electric.db[this.updateTable].deleteMany({
      where: { docId },
    });
  }

  async saveVersionSnapshot(
    docId: string,
    snapshot: Uint8Array,
    metadata: VersionMetadata,
  ): Promise<void> {
    await this.electric.db[this.versionTable].create({
      data: {
        id: crypto.randomUUID(),
        docId,
        snapshot: Buffer.from(snapshot),
        label: metadata.label,
        trigger: metadata.trigger,
        clientId: metadata.clientId,
        createdAt: new Date(metadata.timestamp),
      },
    });
  }

  async listVersions(
    docId: string,
    options?: { limit?: number; before?: string },
  ): Promise<VersionEntry[]> {
    const rows = await this.electric.db[this.versionTable].findMany({
      where: { docId },
      orderBy: { createdAt: 'desc' },
      take: (options?.limit ?? 50) + (options?.before ? 1 : 0),
    });
    const page = options?.before
      ? rows.filter((r: any) => r.id !== options.before)
      : rows;

    return page.slice(0, options?.limit ?? 50).map((r: any) => ({
      id: r.id,
      metadata: {
        label: r.label,
        trigger: r.trigger,
        clientId: r.clientId,
        timestamp: r.createdAt.getTime(),
      },
      createdAt: r.createdAt.getTime(),
    }));
  }

  async loadVersion(
    docId: string,
    versionId: string,
  ): Promise<{ state: Uint8Array; snapshot: Uint8Array }> {
    const row = await this.electric.db[this.versionTable].findUnique({
      where: { id: versionId },
    });
    if (!row) throw new Error(`Version ${versionId} not found`);
    const data = new Uint8Array(row.snapshot);
    return { state: data, snapshot: data };
  }
}
```

**Shape subscriptions.** ElectricSQL's shape-based sync keeps the local copy in sync with the server. When another client writes to the same document row, the shape subscription fires and delivers the update.

---

## Module: `@pen/crdt-loro — adapter.ts`

Alternative CRDT adapter using Loro instead of Yjs. Implements the same `CRDTAdapter` interface.

```typescript
import type {
  CRDTAdapter, CRDTDocument, CRDTEvent, DocumentOp,
} from '@pen/types';
import { LoroDoc, VersionVector } from 'loro-crdt';

interface LoroCRDTDocument extends CRDTDocument {
  _loro: LoroDoc;
}

export class LoroCRDTAdapter implements CRDTAdapter {
  createDocument(id?: string): CRDTDocument {
    const doc = new LoroDoc();

    doc.getList('blockOrder');
    doc.getMap('blocks');
    doc.getMap('apps');
    doc.getMap('metadata');

    return wrapLoroDocument(doc, id);
  }

  applyOps(doc: CRDTDocument, ops: DocumentOp[], origin?: string): void {
    const loro = unwrapLoro(doc);

    loro.checkout();
    for (const op of ops) {
      applyLoroOp(loro, op);
    }
    loro.commit({ origin: origin ?? 'local' });
  }

  observe(doc: CRDTDocument, callback: (event: CRDTEvent) => void): () => void {
    const loro = unwrapLoro(doc);

    const subId = loro.subscribe((event: any) => {
      const crdtEvent = translateLoroEvent(event);
      if (crdtEvent) callback(crdtEvent);
    });

    return () => loro.unsubscribe(subId);
  }

  createSnapshot(doc: CRDTDocument): Uint8Array {
    const loro = unwrapLoro(doc);
    return loro.exportSnapshot();
  }

  restoreSnapshot(doc: CRDTDocument, snapshot: Uint8Array): void {
    const loro = unwrapLoro(doc);
    loro.import(snapshot);
  }

  fork(doc: CRDTDocument): CRDTDocument {
    const loro = unwrapLoro(doc);
    const snapshot = loro.exportSnapshot();
    const forked = new LoroDoc();
    forked.import(snapshot);
    return wrapLoroDocument(forked, crypto.randomUUID());
  }

  merge(target: CRDTDocument, source: CRDTDocument): void {
    const targetLoro = unwrapLoro(target);
    const sourceLoro = unwrapLoro(source);
    const updates = sourceLoro.exportFrom(targetLoro.version());
    targetLoro.import(updates);
  }

  getStateVector(doc: CRDTDocument): Uint8Array {
    const loro = unwrapLoro(doc);
    return loro.version().encode();
  }

  encodeUpdate(doc: CRDTDocument, stateVector?: Uint8Array): Uint8Array {
    const loro = unwrapLoro(doc);
    if (stateVector) {
      return loro.exportFrom(VersionVector.decode(stateVector));
    }
    return loro.exportSnapshot();
  }

  applyUpdate(doc: CRDTDocument, update: Uint8Array): void {
    const loro = unwrapLoro(doc);
    loro.import(update);
  }

  raw(doc: CRDTDocument): any {
    return unwrapLoro(doc);
  }
}

function wrapLoroDocument(doc: any, id?: string): CRDTDocument {
  return { _loro: doc, id: id ?? crypto.randomUUID() } as LoroCRDTDocument;
}

function unwrapLoro(doc: CRDTDocument): any {
  return (doc as LoroCRDTDocument)._loro;
}

function applyLoroOp(doc: any, op: DocumentOp): void {
  const blockOrder = doc.getList('blockOrder');
  const blocks = doc.getMap('blocks');

  switch (op.type) {
    case 'insert-block': {
      const blockMap = doc.getMap(`block:${op.blockId}`);
      blockMap.set('type', op.blockType);
      blockMap.set('props', op.props ?? {});
      const text = doc.getText(`text:${op.blockId}`);
      blocks.set(op.blockId, blockMap.id);
      blockOrder.push(op.blockId);
      break;
    }
    case 'delete-block': {
      const idx = findInList(blockOrder, op.blockId);
      if (idx >= 0) blockOrder.delete(idx, 1);
      blocks.delete(op.blockId);
      break;
    }
    case 'insert-text': {
      const text = doc.getText(`text:${op.blockId}`);
      text.insert(op.offset, op.text);
      break;
    }
    case 'delete-text': {
      const text = doc.getText(`text:${op.blockId}`);
      text.delete(op.offset, op.length);
      break;
    }
    case 'format-text': {
      const text = doc.getText(`text:${op.blockId}`);
      text.mark({ start: op.offset, end: op.offset + op.length }, op.marks);
      break;
    }
    case 'update-block': {
      const blockMap = doc.getMap(`block:${op.blockId}`);
      const existing = blockMap.get('props') ?? {};
      blockMap.set('props', { ...existing, ...op.props });
      break;
    }
    case 'move-block': {
      const oldIdx = findInList(blockOrder, op.blockId);
      if (oldIdx >= 0) {
        blockOrder.delete(oldIdx, 1);
        const newIdx = resolvePosition(blockOrder, op.position);
        blockOrder.insert(newIdx, op.blockId);
      }
      break;
    }
    case 'convert-block': {
      const blockMap = doc.getMap(`block:${op.blockId}`);
      blockMap.set('type', op.newType);
      if (op.newProps) blockMap.set('props', op.newProps);
      break;
    }
  }
}

function findInList(list: any, value: string): number {
  for (let i = 0; i < list.length; i++) {
    if (list.get(i) === value) return i;
  }
  return -1;
}

function resolvePosition(blockOrder: any, position: any): number {
  if (position?.after) {
    const idx = findInList(blockOrder, position.after);
    return idx >= 0 ? idx + 1 : blockOrder.length;
  }
  if (position?.before) {
    const idx = findInList(blockOrder, position.before);
    return idx >= 0 ? idx : 0;
  }
  return blockOrder.length;
}

function translateLoroEvent(event: any): CRDTEvent | null {
  return {
    origin: event.origin ?? 'local',
    ops: [],
    affectedBlocks: [],
  } as CRDTEvent;
}
```

> **Implementation requirement.** The stub event translation is a placeholder. A production Loro adapter MUST implement proper event translation that produces `CRDTEvent` objects with correct `ops` and `affectedBlocks`. Without this, the extension observe dispatch, DocumentState rebuild, and decoration updates will not function. The Loro SDK's `DocObserver` API provides the necessary change events to reconstruct `DocumentOp` arrays.

**Same interface, different CRDT.** The `LoroCRDTAdapter` implements the same `CRDTAdapter` interface as `YjsAdapter`. Applications can swap CRDT backends without changing any other code. Loro offers better performance on large documents and native move semantics.

---

## Module: `@pen/vue — composables/use-editor.ts`

```typescript
import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import type { Editor, EditorConfig } from '@pen/types';
import { createEditor } from '@pen/core';

export function useEditor(config: EditorConfig): {
  editor: Ref<Editor | null>;
  isReady: Ref<boolean>;
} {
  const editor = ref<Editor | null>(null);
  const isReady = ref(false);

  onMounted(() => {
    const instance = createEditor(config);
    editor.value = instance;
    isReady.value = true;
  });

  onUnmounted(() => {
    editor.value?.destroy();
    editor.value = null;
    isReady.value = false;
  });

  return { editor, isReady };
}
```

---

## Module: `@pen/vue — components/PenEditor.vue`

```vue
<template>
  <div
    ref="rootRef"
    data-pen-editor-root
    :data-ready="isReady"
    :data-focused="isFocused"
  >
    <slot v-if="isReady" />
  </div>
</template>

<script setup lang="ts">
import { ref, provide, onMounted, onUnmounted } from 'vue';
import type { Editor, EditorConfig } from '@pen/types';
import { createEditor } from '@pen/core';

const props = defineProps<{
  config: EditorConfig;
}>();

const rootRef = ref<HTMLElement | null>(null);
const editor = ref<Editor | null>(null);
const isReady = ref(false);
const isFocused = ref(false);

provide('pen-editor', editor);

onMounted(() => {
  editor.value = createEditor(props.config);
  isReady.value = true;
});

onUnmounted(() => {
  editor.value?.destroy();
});
</script>
```

---

## Module: `@pen/svelte — stores/editor.ts`

```typescript
import { writable, type Writable } from 'svelte/store';
import type { Editor, EditorConfig } from '@pen/types';
import { createEditor } from '@pen/core';

export function createEditorStore(config: EditorConfig): {
  editor: Writable<Editor | null>;
  isReady: Writable<boolean>;
  destroy: () => void;
} {
  const editor = writable<Editor | null>(null);
  const isReady = writable(false);
  let instance: Editor | null = null;

  instance = createEditor(config);
  editor.set(instance);
  isReady.set(true);

  return {
    editor,
    isReady,
    destroy() {
      instance?.destroy();
      instance = null;
      editor.set(null);
      isReady.set(false);
    },
  };
}
```

---

## Documentation Site

The documentation site uses MDX for content with live editor playgrounds.

### Structure

1. **Getting Started** — Install, quick start, core concepts (blocks, marks, operations, CRDT, extensions).
2. **Guides** — Deep dives: custom blocks, custom marks, writing extensions, AI integration, collaboration, layout, apps, theming.
3. **API Reference** — Per-package reference with types, functions, components, hooks. Auto-generated from TSDoc.
4. **Architecture** — System design: CRDT abstraction, operation pipeline, extension lifecycle, schema engine, rendering model.
5. **Examples** — Full working examples: minimal editor, collaborative editor, AI writing assistant, Notion clone, email builder.

### Live Editor Playground

```typescript
interface LiveEditorProps {
  code: string;
  extensions?: string[];
  editable?: boolean;
  height?: string;
}
```

The playground renders a real Pen editor instance inside the docs page. Users can edit the configuration code and see the result live. Uses sandpack or a custom iframe-based runner.

### API Reference Generation

API docs are generated from TypeScript source using `typedoc` or a custom extractor. Each exported type, function, and component gets:

- Description (from TSDoc)
- Parameters / Props table
- Return type
- Usage example
- Links to related APIs

---

## Dependencies

### `@pen/export-json`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*"
  }
}
```

### `@pen/export-xml`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*"
  }
}
```

### `@pen/auth`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@pen/react": "workspace:*",
    "react": "^19.0.0"
  }
}
```

### `@pen/sync-electricsql`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*"
  },
  "peerDependencies": {
    "electric-sql": ">=0.10.0"
  }
}
```

### `@pen/crdt-loro`

```json
{
  "dependencies": {
    "@pen/types": "workspace:*",
    "loro-crdt": ">=1.0.0"
  }
}
```

### `@pen/vue`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*"
  },
  "peerDependencies": {
    "vue": "^3.4.0"
  }
}
```

### `@pen/svelte`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*"
  },
  "peerDependencies": {
    "svelte": "^5.0.0"
  }
}
```

---

## Key Decisions

1. **JSON as canonical serialization.** The JSON exporter preserves full fidelity — block structure, inline marks, metadata, app data. It's the format for persistence, API transport, and clipboard. Version-stamped with explicit migrators and a deprecation window policy (support current + previous major format).

2. **XML for interoperability.** The XML exporter provides an alternative interchange format for systems that prefer XML (DITA, DocBook, enterprise integrations).

3. **Role-based auth with operation-level granularity.** Six roles (owner → anonymous). Each `DocumentOp` is individually authorized. Denied ops are dropped with diagnostics/audit events. Partial application is allowed (e.g. commenter can suggest but not direct-edit).

4. **Auth guard intercepts `onBeforeApply`.** Same hook point as input rules. Only explicitly trusted origins bypass checks (default: `'system'`). Remote operations are checked unless explicitly trusted by host policy.

5. **JWT provider has a production verification path.** Signature verification is required in production via pluggable `verify()`; claim checks (`exp`/`iss`/`aud`) are enforced after verification.

6. **ElectricSQL provider implements `PenPersistence`.** Stores CRDT state as binary `Uint8Array` in a synced table. Shape subscriptions deliver updates from other clients. This is a local-first persistence model — works offline, syncs when connected.

7. **Loro adapter proves the CRDT abstraction.** If `LoroCRDTAdapter` implements `CRDTAdapter` without changes to any other package, the abstraction is validated. Loro offers native move semantics and better large-document performance.

8. **Vue composables mirror React hooks.** `useEditor()`, `useSelection()`, `useBlockList()` — same names, same semantics, idiomatic Vue implementation (ref + provide/inject).

9. **Svelte stores mirror React hooks.** Writable stores instead of hooks. Same editor lifecycle. `createEditorStore()` returns a store + destroy function.

10. **Documentation site includes live playgrounds.** Users can try Pen directly in the docs. Each example is a real editor instance. This is the primary onboarding experience.

---

## Acceptance Criteria

Production claims for this wave are valid only when v01 release gates are met (security, compatibility, reliability, performance, soak). The criteria below are package-level checks and do not replace those gates.

1. JSON export produces full-fidelity document representation with version field.
2. JSON import creates all blocks, text content, and inline marks from JSON.
3. Round-trip: export → import produces an identical document (`assertDocEquals` passes).
4. XML export produces valid XML with block type, ID, props, and text content.
5. XML import creates blocks from XML elements.
6. Policy engine correctly grants/denies permissions based on role.
7. Editor guard drops unauthorized operations and emits diagnostics/audit events.
8. `viewer` role can read but not write. `editor` role can read and write. `commenter` can only comment and suggest.
9. JWT provider validates signature (via configured verifier) and token claims (expiry, issuer, audience).
10. JWT provider extracts user ID, name, email, and role from token payload.
11. Trusted-origin bypass is explicit and configurable; `remote` is not bypassed by default.
12. `Pen.Auth.RequireRole` conditionally renders children based on user role.
13. ElectricSQL provider loads and saves document state as binary.
14. ElectricSQL provider receives updates via shape subscription when remote changes occur.
15. `LoroCRDTAdapter` implements all `CRDTAdapter` methods.
16. `LoroCRDTAdapter` passes the same test suite as `YjsAdapter` (excluding Yjs-specific internals).
17. Document operations (insert, delete, update, move, format) work identically with Loro backend.
18. `fork` and `merge` work with Loro.
19. Vue `useEditor()` creates and destroys editor instances with component lifecycle.
20. Vue `PenEditor.vue` renders blocks and supports typing, selection, and paste in integration tests.
21. Svelte `createEditorStore()` creates and destroys editor instances.
22. Svelte `PenEditor.svelte` renders blocks and supports typing, selection, and paste in integration tests.
23. Documentation site has getting-started, guides, API reference, architecture, and examples sections.
24. Live editor playground renders a functional Pen editor in the docs page.
25. API reference is generated from TypeScript source with descriptions, parameter tables, and examples.
26. `pen create` CLI includes M3 packages as optional features.
27. `getUpdates(docId, since)` returns only updates newer than the checkpoint.
28. `listVersions(docId, { before, limit })` paginates deterministically with no duplicate entries across pages.
29. Importer migration policy is enforced: known versions migrate, unknown versions fail deterministically.
