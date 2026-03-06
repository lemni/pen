# Wave 11 — Apps, Execution & Branching

**Milestone:** M2 · **Packages:** `@pen/apps`, `@pen/execution`, `@pen/skills`, `@pen/branch` · **Depends on:** M1 (Waves 0-9), Wave 10

---

## Goal

Ship the app embedding system (`defineApp()`, sandboxing, lifecycle), code execution primitives (`bash`, file operations), the skills framework (`list_skills`, `run_skill`), and the document branching prototype. After this wave, third-party apps can be embedded in documents, LLMs can execute code and run skills, and users can create document branches (forks) for experimentation.

---

## File Structure

### `@pen/apps`

```
packages/extensions/apps/src/
├── extension.ts                defineExtension — entry point, app registry
├── registry/
│   ├── app-registry.ts         Runtime app registry
│   └── app-resolver.ts         Resolve app ID → AppDefinition
├── bridge/
│   ├── define-app.ts           defineApp() public API
│   ├── app-handle.ts           AppHandle: read/write props, emit, subscribe
│   └── placement.ts            Placement resolver (inline vs anchored)
├── sandbox/
│   ├── none.ts                 No isolation — direct render
│   ├── error-boundary.ts       React error boundary wrapper
│   ├── iframe.ts               iframe sandbox (postMessage bridge)
│   ├── iframe-bridge.ts        Parent ↔ iframe communication protocol
│   └── resolver.ts             Pick sandbox by isolation level
├── lifecycle/
│   ├── mount.ts                App mount lifecycle
│   ├── unmount.ts              App unmount / cleanup
│   └── config-change.ts        Config prop change handler
├── tools/
│   ├── insert-app.ts           LLM tool: insert an app into the document
│   ├── update-app-config.ts    LLM tool: update app configuration
│   ├── list-apps.ts            LLM tool: list registered apps
│   └── index.ts                Barrel
├── primitives/
│   ├── app-root.tsx            Pen.App.Root — app rendering root
│   ├── app-config.tsx          Pen.App.Config — configuration panel
│   ├── app-toolbar.tsx         Pen.App.Toolbar — app-specific toolbar
│   ├── app-placeholder.tsx     Pen.App.Placeholder — loading/error state
│   └── index.ts                Barrel
├── hooks/
│   ├── use-app.ts              useApp() — app context (config, actions)
│   ├── use-app-config.ts       useAppConfig() — read/write config props
│   └── index.ts                Barrel
├── types.ts                    App-specific types
└── index.ts                    Package entry
```

### `@pen/execution`

```
packages/extensions/execution/src/
├── extension.ts                defineExtension — entry point
├── providers/
│   ├── local-provider.ts       Local execution (Node.js child_process)
│   ├── sandbox-provider.ts     Sandboxed execution (container-based)
│   └── provider.ts             ExecutionProvider interface
├── tools/
│   ├── bash.ts                 bash tool — execute shell commands
│   ├── write-file.ts           write_file tool
│   ├── read-file.ts            read_file tool
│   ├── list-files.ts           list_files tool
│   ├── upload-to-document.ts   upload_to_document tool
│   └── index.ts                Barrel
├── sandbox/
│   ├── permissions.ts          Permission model (allow/deny patterns)
│   ├── path-resolver.ts        Resolve and validate file paths
│   └── timeout.ts              Execution timeout management
├── primitives/
│   ├── terminal.tsx            Pen.Execution.Terminal — output display
│   ├── file-tree.tsx           Pen.Execution.FileTree — file browser
│   └── index.ts                Barrel
├── hooks/
│   ├── use-execution.ts        useExecution() — execution state
│   └── index.ts                Barrel
├── types.ts                    Execution types
└── index.ts                    Package entry
```

### `@pen/skills`

```
packages/extensions/skills/src/
├── extension.ts                defineExtension — entry point
├── registry/
│   ├── skill-registry.ts       Runtime skill registry
│   └── default-skills.ts       Default built-in skills
├── tools/
│   ├── list-skills.ts          list_skills tool
│   ├── get-skill-guide.ts      get_skill_guide tool
│   ├── run-skill.ts            run_skill tool
│   └── index.ts                Barrel
├── types.ts                    Skill types
└── index.ts                    Package entry
```

### `@pen/branch`

```
packages/extensions/branch/src/
├── extension.ts                defineExtension — entry point
├── fork.ts                     Fork document (CRDT clone)
├── merge.ts                    Merge branch back (CRDT merge)
├── diff.ts                     Diff between branch and parent
├── primitives/
│   ├── branch-indicator.tsx    Pen.Branch.Indicator
│   ├── branch-switcher.tsx     Pen.Branch.Switcher
│   ├── merge-dialog.tsx        Pen.Branch.MergeDialog
│   └── index.ts                Barrel
├── hooks/
│   ├── use-branch.ts           useBranch() — branch state
│   └── index.ts                Barrel
├── types.ts                    Branch types
└── index.ts                    Package entry
```

### Import DAG

```
@pen/apps:
  types.ts                    ← (@pen/types)
  registry/*                  ← types.ts, (@pen/types)
  bridge/define-app.ts        ← types.ts, registry/*, bridge/app-handle.ts
  bridge/app-handle.ts        ← types.ts, (@pen/types)
  bridge/placement.ts         ← types.ts, (@pen/types)
  sandbox/*                   ← types.ts
  sandbox/iframe-bridge.ts    ← types.ts
  lifecycle/*                 ← types.ts, registry/*, bridge/*, sandbox/*
  tools/*                     ← registry/*, types.ts, (@pen/types)
  extension.ts                ← registry/*, lifecycle/*, tools/*, sandbox/*, (@pen/types)
  hooks/*                     ← extension.ts, types.ts, (react)
  primitives/*                ← hooks/*, sandbox/*, types.ts, (react)

@pen/execution:
  types.ts                    ← (@pen/types)
  providers/provider.ts       ← types.ts
  providers/local-provider.ts ← providers/provider.ts, sandbox/*
  providers/sandbox-provider.ts ← providers/provider.ts, sandbox/*
  sandbox/*                   ← types.ts
  tools/*                     ← providers/provider.ts, sandbox/*, types.ts, (@pen/types)
  extension.ts                ← providers/*, tools/*, (@pen/types)
  hooks/*                     ← extension.ts, types.ts, (react)
  primitives/*                ← hooks/*, types.ts, (react)

@pen/skills:
  types.ts                    ← (@pen/types)
  registry/*                  ← types.ts
  tools/*                     ← registry/*, types.ts, (@pen/types)
  extension.ts                ← registry/*, tools/*, (@pen/types)

@pen/branch:
  types.ts                    ← (@pen/types)
  fork.ts                     ← types.ts, (@pen/types)
  merge.ts                    ← types.ts, fork.ts, (@pen/types)
  diff.ts                     ← types.ts, (@pen/types)
  extension.ts                ← fork.ts, merge.ts, diff.ts, (@pen/types)
  hooks/*                     ← extension.ts, types.ts, (react)
  primitives/*                ← hooks/*, types.ts, (react)
```

No cycles.

---

## Module: `@pen/apps — types.ts`

```typescript
import type { Editor, BlockHandle, Unsubscribe, PropSchema } from '@pen/types';

export interface AppDefinition {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  version: string;
  configSchema: Record<string, PropSchema>;
  defaultPlacement: AppPlacement;
  allowedPlacements: AppPlacement[];
  isolation: AppIsolation;
  component: AppComponent;
  onMount?: (ctx: AppContext) => void | (() => void);
  onConfigChange?: (ctx: AppContext, prev: Record<string, unknown>) => void;
  onAnchorDeleted?: AppAnchorDeletedBehavior;
  serialize?: {
    toMarkdown?: (config: Record<string, unknown>) => string;
    toHTML?: (config: Record<string, unknown>) => string;
    toXML?: (config: Record<string, unknown>) => string;
  };
  aiDescription?: string;
}

export type AppComponent = React.ComponentType<AppProps>;

export interface AppProps {
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  editor: AppEditorAPI;
  blockId: string;
  appId: string;
}

export interface AppEditorAPI {
  readBlock: (blockId: string) => { type: string; text: string; props: Record<string, unknown> } | null;
  readDocument: () => { blockOrder: string[]; blocks: Map<string, any> };
  insertBlock: (blockType: string, props: Record<string, unknown>, position?: any) => string;
  updateBlock: (blockId: string, props: Record<string, unknown>) => void;
  deleteBlock: (blockId: string) => void;
  onDocumentChange: (cb: () => void) => Unsubscribe;
}

export type AppPlacement = 'inline' | 'anchored';
export type AppIsolation = 'none' | 'error-boundary' | 'iframe';
export type AppAnchorDeletedBehavior = 'delete' | 'orphan';

export interface AppContext {
  appId: string;
  blockId: string;
  config: Record<string, unknown>;
  editor: AppEditorAPI;
  setConfig: (config: Record<string, unknown>) => void;
}

export interface AppInstance {
  id: string;
  definition: AppDefinition;
  blockId: string;
  config: Record<string, unknown>;
  placement: AppPlacement;
  mountedAt: number;
  cleanup?: () => void;
}
```

---

## Module: `bridge/define-app.ts` — `defineApp()` Public API

The primary API for third-party app authors.

```typescript
import type { PropSchema } from '@pen/types';
import type { AppDefinition, AppIsolation, AppPlacement, AppComponent, AppAnchorDeletedBehavior, AppContext } from '../types.js';

export interface DefineAppOptions {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  version: string;
  configSchema: Record<string, PropSchema>;
  defaultPlacement?: AppPlacement;
  allowedPlacements?: AppPlacement[];
  isolation?: AppIsolation;
  component: AppComponent;
  onMount?: (ctx: AppContext) => void | (() => void);
  onConfigChange?: (ctx: AppContext, prev: Record<string, unknown>) => void;
  onAnchorDeleted?: AppAnchorDeletedBehavior;
  serialize?: {
    toMarkdown?: (config: Record<string, unknown>) => string;
    toHTML?: (config: Record<string, unknown>) => string;
    toXML?: (config: Record<string, unknown>) => string;
  };
  aiDescription?: string;
}

export function defineApp(options: DefineAppOptions): AppDefinition {
  return {
    id: options.id,
    name: options.name,
    description: options.description,
    icon: options.icon,
    version: options.version,
    configSchema: options.configSchema,
    defaultPlacement: options.defaultPlacement ?? 'inline',
    allowedPlacements: options.allowedPlacements ?? ['inline', 'anchored'],
    isolation: options.isolation ?? 'error-boundary',
    component: options.component,
    onMount: options.onMount,
    onConfigChange: options.onConfigChange,
    onAnchorDeleted: options.onAnchorDeleted ?? 'delete',
    serialize: options.serialize,
    aiDescription: options.aiDescription,
  };
}
```

---

## Module: `bridge/app-handle.ts` — App Handle

Read/write API that apps use to interact with the editor. Restricted surface area compared to the full `Editor` — apps can't access raw CRDT, selection, or decorations.

```typescript
import type { Editor, Unsubscribe } from '@pen/types';
import type { AppEditorAPI } from '../types.js';

export function createAppEditorAPI(editor: Editor): AppEditorAPI {
  return {
    readBlock(blockId) {
      const handle = editor.getBlock(blockId);
      if (!handle) return null;
      return {
        type: handle.type,
        text: handle.textContent(),
        props: { ...handle.props },
      };
    },

    readDocument() {
      const blockOrder = [...editor.documentState.blockOrder];
      const blocks = new Map<string, any>();
      for (const id of blockOrder) {
        const handle = editor.getBlock(id);
        if (handle) {
          blocks.set(id, {
            type: handle.type,
            text: handle.textContent(),
            props: { ...handle.props },
          });
        }
      }
      return { blockOrder, blocks };
    },

    insertBlock(blockType, props, position) {
      const id = crypto.randomUUID();
      editor.apply([{
        type: 'insert-block', blockId: id, blockType, props, position,
      }], { origin: 'app' });
      return id;
    },

    updateBlock(blockId, props) {
      editor.apply([{
        type: 'update-block', blockId, props,
      }], { origin: 'app' });
    },

    deleteBlock(blockId) {
      editor.apply([{
        type: 'delete-block', blockId,
      }], { origin: 'app' });
    },

    onDocumentChange(cb) {
      return editor.onDocumentChange(cb);
    },
  };
}
```

**Restricted API surface.** Apps get `readBlock`, `readDocument`, `insertBlock`, `updateBlock`, `deleteBlock`, `onDocumentChange`. No access to selection, CRDT internals, decorations, or other extensions. This is the security boundary.

---

## Module: `registry/app-registry.ts` — App Registry

```typescript
import type { AppDefinition, AppInstance } from '../types.js';

export class AppRegistry {
  private definitions = new Map<string, AppDefinition>();
  private instances = new Map<string, AppInstance>();
  private listeners = new Set<() => void>();

  register(definition: AppDefinition): void {
    this.definitions.set(definition.id, definition);
    this.notify();
  }

  unregister(id: string): void {
    this.definitions.delete(id);
    this.notify();
  }

  getDefinition(id: string): AppDefinition | null {
    return this.definitions.get(id) ?? null;
  }

  listDefinitions(): AppDefinition[] {
    return [...this.definitions.values()];
  }

  addInstance(instance: AppInstance): void {
    this.instances.set(instance.id, instance);
    this.notify();
  }

  removeInstance(instanceId: string): void {
    const instance = this.instances.get(instanceId);
    if (instance?.cleanup) instance.cleanup();
    this.instances.delete(instanceId);
    this.notify();
  }

  getInstance(instanceId: string): AppInstance | null {
    return this.instances.get(instanceId) ?? null;
  }

  listInstances(): AppInstance[] {
    return [...this.instances.values()];
  }

  getInstancesForBlock(blockId: string): AppInstance[] {
    return [...this.instances.values()].filter(i => i.blockId === blockId);
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }
}
```

---

## Module: `sandbox/none.ts` — No Isolation

Direct render. The app component runs in the same React tree. No boundary.

```typescript
import type { AppProps, AppComponent } from '../types.js';

export function renderNoIsolation(
  Component: AppComponent,
  props: AppProps,
): React.ReactElement {
  return <Component {...props} />;
}
```

---

## Module: `sandbox/error-boundary.ts` — Error Boundary

```typescript
import React from 'react';
import type { AppProps, AppComponent } from '../types.js';

interface State {
  hasError: boolean;
  error: Error | null;
}

class AppErrorBoundary extends React.Component<
  { component: AppComponent; appProps: AppProps; fallback?: React.ReactNode },
  State
> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(`[pen/apps] App "${this.props.appProps.appId}" crashed:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? (
        <div data-pen-app-error data-app-id={this.props.appProps.appId}>
          App crashed: {this.state.error?.message}
        </div>
      );
    }

    const Component = this.props.component;
    return <Component {...this.props.appProps} />;
  }
}

export function renderWithErrorBoundary(
  Component: AppComponent,
  props: AppProps,
  fallback?: React.ReactNode,
): React.ReactElement {
  return <AppErrorBoundary component={Component} appProps={props} fallback={fallback} />;
}
```

---

## Module: `sandbox/iframe.ts` — iframe Sandbox

Full isolation. The app runs in an iframe. Communication is via `postMessage`. Config changes, editor reads/writes, and events all go through the bridge.

```typescript
import type { AppProps, AppComponent, AppEditorAPI } from '../types.js';
import { createIframeBridge, type IframeBridge } from './iframe-bridge.js';

export interface IframeSandboxOptions {
  srcDoc?: string;
  allow?: string;
  sandbox?: string;
}

export function renderInIframe(
  _Component: AppComponent,
  props: AppProps,
  options?: IframeSandboxOptions,
): React.ReactElement {
  return (
    <IframeSandboxHost
      appId={props.appId}
      blockId={props.blockId}
      config={props.config}
      onConfigChange={props.onConfigChange}
      editor={props.editor}
      options={options}
    />
  );
}

function IframeSandboxHost(props: {
  appId: string;
  blockId: string;
  config: Record<string, unknown>;
  onConfigChange: (config: Record<string, unknown>) => void;
  editor: AppEditorAPI;
  options?: IframeSandboxOptions;
}) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const bridgeRef = React.useRef<IframeBridge | null>(null);

  React.useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    const bridge = createIframeBridge(iframe.contentWindow, {
      onConfigChange: props.onConfigChange,
      editor: props.editor,
    });
    bridgeRef.current = bridge;

    bridge.send('init', {
      appId: props.appId,
      blockId: props.blockId,
      config: props.config,
    });

    return () => bridge.destroy();
  }, []);

  React.useEffect(() => {
    bridgeRef.current?.send('config-update', { config: props.config });
  }, [props.config]);

  return (
    <iframe
      ref={iframeRef}
      data-pen-app-iframe
      data-app-id={props.appId}
      sandbox={props.options?.sandbox ?? 'allow-scripts'}
      style={{ border: 'none', width: '100%' }}
    />
  );
}
```

---

## Module: `sandbox/iframe-bridge.ts` — iframe Communication

```typescript
import type { AppEditorAPI } from '../types.js';

export interface IframeBridge {
  send: (type: string, payload: unknown) => void;
  destroy: () => void;
}

interface BridgeOptions {
  onConfigChange: (config: Record<string, unknown>) => void;
  editor: AppEditorAPI;
  targetOrigin: string;
}

export function createIframeBridge(
  target: Window,
  options: BridgeOptions,
): IframeBridge {
  const targetOrigin = options.targetOrigin;

  const messageHandler = (event: MessageEvent) => {
    if (event.source !== target) return;
    if (event.origin !== targetOrigin) return;

    const { type, payload, requestId } = event.data ?? {};

    switch (type) {
      case 'config-change':
        options.onConfigChange(payload);
        break;

      case 'read-block': {
        const result = options.editor.readBlock(payload.blockId);
        target.postMessage({ type: 'response', requestId, result }, targetOrigin);
        break;
      }

      case 'read-document': {
        const result = options.editor.readDocument();
        target.postMessage({
          type: 'response',
          requestId,
          result: {
            blockOrder: result.blockOrder,
            blocks: Object.fromEntries(result.blocks),
          },
        }, targetOrigin);
        break;
      }

      case 'insert-block': {
        const id = options.editor.insertBlock(
          payload.blockType,
          payload.props,
          payload.position,
        );
        target.postMessage({ type: 'response', requestId, result: id }, targetOrigin);
        break;
      }

      case 'update-block':
        options.editor.updateBlock(payload.blockId, payload.props);
        target.postMessage({ type: 'response', requestId, result: true }, targetOrigin);
        break;

      case 'delete-block':
        options.editor.deleteBlock(payload.blockId);
        target.postMessage({ type: 'response', requestId, result: true }, targetOrigin);
        break;
    }
  };

  window.addEventListener('message', messageHandler);

  return {
    send(type, payload) {
      target.postMessage({ type, payload }, targetOrigin);
    },
    destroy() {
      window.removeEventListener('message', messageHandler);
    },
  };
}
```

**Request/response model.** Editor reads from the iframe use `requestId` for correlation. The iframe sends a request, the host responds with the same `requestId`. This allows async operations across the iframe boundary.

**Security requirement (normative).** The bridge MUST validate `event.origin` against an allowlist and MUST never use wildcard (`'*'`) for response targets. Host and iframe must use an explicit `targetOrigin` string.

---

## Module: `lifecycle/mount.ts` — App Mount

```typescript
import type { Editor } from '@pen/types';
import type { AppDefinition, AppInstance, AppContext } from '../types.js';
import { AppRegistry } from '../registry/app-registry.js';
import { createAppEditorAPI } from '../bridge/app-handle.js';

export function mountApp(
  editor: Editor,
  registry: AppRegistry,
  definition: AppDefinition,
  blockId: string,
  config: Record<string, unknown>,
): AppInstance {
  const instanceId = crypto.randomUUID();
  const editorAPI = createAppEditorAPI(editor);

  const ctx: AppContext = {
    appId: definition.id,
    blockId,
    config,
    editor: editorAPI,
    setConfig(newConfig) {
      const instance = registry.getInstance(instanceId);
      if (!instance) return;
      instance.config = { ...instance.config, ...newConfig };
      editor.apply([{
        type: 'update-block',
        blockId,
        props: { appConfig: instance.config },
      }], { origin: 'app' });
    },
  };

  let cleanup: (() => void) | undefined;
  if (definition.onMount) {
    const result = definition.onMount(ctx);
    if (typeof result === 'function') cleanup = result;
  }

  const instance: AppInstance = {
    id: instanceId,
    definition,
    blockId,
    config,
    placement: definition.defaultPlacement,
    mountedAt: Date.now(),
    cleanup,
  };

  registry.addInstance(instance);
  return instance;
}
```

---

## Module: `@pen/execution — types.ts`

```typescript
export interface ExecutionProvider {
  execute(command: string, options?: ExecutionOptions): Promise<ExecutionResult>;
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  listFiles(path: string): Promise<FileEntry[]>;
  isAvailable(): Promise<boolean>;
}

export interface ExecutionOptions {
  cwd?: string;
  timeout?: number;
  env?: Record<string, string>;
  signal?: AbortSignal;
  commandMode?: 'argv' | 'shell';
}

export interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  duration: number;
  timedOut: boolean;
}

export interface FileEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: number;
}

export interface ExecutionPermissions {
  allowedCommands?: string[];
  deniedCommands?: string[];
  allowedPaths?: string[];
  deniedPaths?: string[];
  maxTimeout?: number;
  allowNetwork?: boolean;
  allowShell?: boolean;
}
```

---

## Module: `providers/local-provider.ts` — Local Execution Provider

```typescript
import { spawn } from 'node:child_process';
import { readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { ExecutionProvider, ExecutionOptions, ExecutionResult, FileEntry } from '../types.js';
import { validatePath } from '../sandbox/path-resolver.js';
import { checkCommandPermission, checkPathPermission } from '../sandbox/permissions.js';
import type { ExecutionPermissions } from '../types.js';

export class LocalExecutionProvider implements ExecutionProvider {
  private basePath: string;
  private permissions: ExecutionPermissions;

  constructor(basePath: string, permissions: ExecutionPermissions = {}) {
    this.basePath = resolve(basePath);
    this.permissions = permissions;
  }

  async execute(command: string, options?: ExecutionOptions): Promise<ExecutionResult> {
    const args = splitCommand(command);
    const executable = args[0];
    if (!executable) throw new Error('Command cannot be empty');

    checkCommandPermission(executable, this.permissions);
    if (this.permissions.allowNetwork === false) {
      const env = options?.env ?? {};
      if (env.HTTP_PROXY || env.HTTPS_PROXY || env.ALL_PROXY) {
        throw new Error('Network access is disabled by execution permissions');
      }
    }

    const timeout = Math.min(
      options?.timeout ?? 30_000,
      this.permissions.maxTimeout ?? 60_000,
    );

    const cwd = options?.cwd
      ? validatePath(options.cwd, this.basePath)
      : this.basePath;

    return new Promise<ExecutionResult>((resolvePromise) => {
      const start = Date.now();
      let stdout = '';
      let stderr = '';
      let timedOut = false;

      const proc = options?.commandMode === 'shell'
        ? (() => {
            if (this.permissions.allowShell !== true) {
              throw new Error('Shell execution is disabled by execution permissions');
            }
            return spawn('sh', ['-c', command], {
              cwd,
              env: { ...process.env, ...options?.env },
              signal: options?.signal,
            });
          })()
        : spawn(executable, args.slice(1), {
            cwd,
            env: { ...process.env, ...options?.env },
            signal: options?.signal,
          });

      const controller = new AbortController();
      if (options?.signal) {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill('SIGTERM');
        setTimeout(() => proc.kill('SIGKILL'), 5_000);
      }, timeout);

      proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
      proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        clearTimeout(timer);
        resolvePromise({
          exitCode: code ?? 1,
          stdout: stdout.slice(0, 100_000),
          stderr: stderr.slice(0, 100_000),
          duration: Date.now() - start,
          timedOut,
        });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        resolvePromise({
          exitCode: 1,
          stdout: '',
          stderr: err.message,
          duration: Date.now() - start,
          timedOut: false,
        });
      });
    });
  }

  async writeFile(path: string, content: string): Promise<void> {
    const resolved = validatePath(path, this.basePath);
    checkPathPermission(resolved, this.permissions);
    await writeFile(resolved, content, 'utf-8');
  }

  async readFile(path: string): Promise<string> {
    const resolved = validatePath(path, this.basePath);
    checkPathPermission(resolved, this.permissions);
    return readFile(resolved, 'utf-8');
  }

  async listFiles(path: string): Promise<FileEntry[]> {
    const resolved = validatePath(path, this.basePath);
    const entries = await readdir(resolved, { withFileTypes: true });

    const results: FileEntry[] = [];
    for (const entry of entries) {
      const fullPath = join(resolved, entry.name);
      const stats = await stat(fullPath).catch(() => null);
      results.push({
        name: entry.name,
        path: fullPath,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stats?.size,
        modifiedAt: stats?.mtimeMs,
      });
    }

    return results;
  }

  async isAvailable(): Promise<boolean> {
    return true;
  }
}

function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean);
}
```

**Output truncation.** stdout and stderr are capped at 100KB to prevent memory issues from chatty commands.

**Timeout handling.** SIGTERM first, then SIGKILL after 5 seconds. The `timedOut` flag tells the caller what happened.

---

## Module: `sandbox/permissions.ts` — Permission Model

```typescript
import type { ExecutionPermissions } from '../types.js';

export function checkPermission(
  target: string,
  permissions: ExecutionPermissions,
): void {
  checkCommandPermission(target, permissions);
  checkPathPermission(target, permissions);
}

export function checkCommandPermission(
  command: string,
  permissions: ExecutionPermissions,
): void {
  if (permissions.deniedCommands) {
    for (const pattern of permissions.deniedCommands) {
      if (matchGlob(command, pattern)) {
        throw new Error(`Command "${command}" is denied by execution permissions`);
      }
    }
  }

  if (permissions.allowedCommands) {
    const allowed = permissions.allowedCommands.some(p => matchGlob(command, p));
    if (!allowed) {
      throw new Error(`Command "${command}" is not in the allowed commands list`);
    }
  }
}

export function checkPathPermission(
  targetPath: string,
  permissions: ExecutionPermissions,
): void {
  if (permissions.deniedPaths) {
    for (const pattern of permissions.deniedPaths) {
      if (matchGlob(targetPath, pattern)) {
        throw new Error(`Path "${targetPath}" is denied by execution permissions`);
      }
    }
  }

  if (permissions.allowedPaths) {
    const allowed = permissions.allowedPaths.some(p => matchGlob(targetPath, p));
    if (!allowed && targetPath.startsWith('/')) {
      throw new Error(`Path "${targetPath}" is not in the allowed paths list`);
    }
  }
}

function matchGlob(str: string, pattern: string): boolean {
  const regex = new RegExp(
    '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
  );
  return regex.test(str);
}
```

---

## Module: `sandbox/path-resolver.ts` — Path Resolution

```typescript
import { resolve, relative, isAbsolute } from 'node:path';

export function validatePath(inputPath: string, basePath: string): string {
  const resolved = isAbsolute(inputPath)
    ? resolve(inputPath)
    : resolve(basePath, inputPath);

  const rel = relative(basePath, resolved);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path "${inputPath}" escapes the base directory`);
  }

  return resolved;
}
```

**Path traversal prevention.** All file paths are resolved against a base directory. Any path that escapes (via `../`) is rejected.

---

## Module: `tools/bash.ts` — Bash Execution Tool

```typescript
import type { ToolDefinition } from '@pen/types';
import type { ExecutionProvider } from '../types.js';

export function createBashTool(provider: ExecutionProvider): ToolDefinition {
  return {
    name: 'bash',
    description: 'Execute a shell command. Returns stdout, stderr, and exit code.',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute',
        },
        cwd: {
          type: 'string',
          description: 'Working directory (relative to project root)',
        },
        timeout: {
          type: 'number',
          description: 'Timeout in milliseconds (default: 30000)',
        },
      },
      required: ['command'],
    },

    async execute(input) {
      const { command, cwd, timeout } = input as {
        command: string;
        cwd?: string;
        timeout?: number;
      };

      const result = await provider.execute(command, { cwd, timeout });

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        duration: result.duration,
        timedOut: result.timedOut,
      };
    },
  };
}
```

---

## Module: `tools/upload-to-document.ts` — Upload Tool

Reads a file from the execution environment and inserts its content into the document.

```typescript
import type { ToolDefinition, Editor } from '@pen/types';
import type { ExecutionProvider } from '../types.js';

export function createUploadToDocumentTool(
  provider: ExecutionProvider,
  editor: Editor,
): ToolDefinition {
  return {
    name: 'upload_to_document',
    description: 'Read a file from the workspace and insert its content as a new block in the document.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'File path to read' },
        blockType: {
          type: 'string',
          description: 'Block type to create (default: "code")',
          default: 'code',
        },
        position: {
          type: 'object',
          description: 'Where to insert (optional)',
          properties: {
            after: { type: 'string' },
            before: { type: 'string' },
          },
        },
      },
      required: ['path'],
    },

    async execute(input) {
      const { path, blockType, position } = input as {
        path: string;
        blockType?: string;
        position?: { after?: string; before?: string };
      };

      const content = await provider.readFile(path);
      const blockId = crypto.randomUUID();

      const ext = path.split('.').pop() ?? '';
      const language = inferLanguage(ext);

      editor.apply([
        {
          type: 'insert-block',
          blockId,
          blockType: blockType ?? 'code',
          props: language ? { language } : {},
          position,
        },
        {
          type: 'insert-text',
          blockId,
          offset: 0,
          text: content,
        },
      ], { origin: 'ai' });

      return { success: true, blockId, contentLength: content.length };
    },
  };
}

function inferLanguage(ext: string): string | undefined {
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
    css: 'css', html: 'html', json: 'json', yaml: 'yaml', yml: 'yaml',
    md: 'markdown', sql: 'sql', sh: 'bash', bash: 'bash',
  };
  return map[ext];
}
```

---

## Module: `@pen/skills — types.ts`

```typescript
export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  guide: string;
  parameters?: SkillParameter[];
  execute: (params: Record<string, unknown>) => Promise<unknown>;
}

export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean';
  description: string;
  required?: boolean;
  default?: unknown;
}
```

---

## Module: `registry/skill-registry.ts` — Skill Registry

```typescript
import type { SkillDefinition } from '../types.js';

export class SkillRegistry {
  private skills = new Map<string, SkillDefinition>();

  register(skill: SkillDefinition): void {
    this.skills.set(skill.id, skill);
  }

  unregister(id: string): void {
    this.skills.delete(id);
  }

  get(id: string): SkillDefinition | null {
    return this.skills.get(id) ?? null;
  }

  list(category?: string): SkillDefinition[] {
    const all = [...this.skills.values()];
    if (!category) return all;
    return all.filter(s => s.category === category);
  }

  categories(): string[] {
    const cats = new Set<string>();
    for (const skill of this.skills.values()) {
      cats.add(skill.category);
    }
    return [...cats].sort();
  }
}
```

---

## Module: `registry/default-skills.ts` — Default Skills

```typescript
import type { SkillDefinition } from '../types.js';

export const defaultSkills: SkillDefinition[] = [
  {
    id: 'skill:summarize-document',
    name: 'Summarize Document',
    description: 'Generate a concise summary of the current document',
    category: 'writing',
    guide: 'Reads all blocks in the document and produces a structured summary with key points.',
    parameters: [
      { name: 'maxLength', type: 'number', description: 'Maximum summary length in words', default: 200 },
      { name: 'format', type: 'string', description: 'Summary format', default: 'bullets' },
    ],
    async execute(params) {
      return { type: 'prompt', prompt: `Summarize this document in ${params.maxLength ?? 200} words as ${params.format ?? 'bullets'}.` };
    },
  },
  {
    id: 'skill:translate-document',
    name: 'Translate Document',
    description: 'Translate the entire document to another language',
    category: 'language',
    guide: 'Translates all text content block-by-block while preserving formatting and structure.',
    parameters: [
      { name: 'targetLanguage', type: 'string', description: 'Target language', required: true },
    ],
    async execute(params) {
      return { type: 'prompt', prompt: `Translate every block to ${params.targetLanguage}. Preserve all formatting.` };
    },
  },
  {
    id: 'skill:generate-toc',
    name: 'Generate Table of Contents',
    description: 'Create a table of contents from document headings',
    category: 'structure',
    guide: 'Scans all heading blocks and generates a linked table of contents.',
    parameters: [
      { name: 'maxDepth', type: 'number', description: 'Maximum heading depth', default: 3 },
    ],
    async execute(params) {
      return { type: 'prompt', prompt: `Generate a table of contents from headings up to depth ${params.maxDepth ?? 3}.` };
    },
  },
  {
    id: 'skill:proofread',
    name: 'Proofread',
    description: 'Check for grammar, spelling, and style issues',
    category: 'writing',
    guide: 'Reviews the document for errors and suggests corrections using track changes.',
    async execute() {
      return { type: 'prompt', prompt: 'Proofread this document. Use suggest mode to mark corrections.' };
    },
  },
];
```

**Skills return prompts.** Default skills don't execute directly — they return `{ type: 'prompt', prompt }` objects that the AI extension feeds to the model. This keeps the skill framework simple and composable with the agentic loop.

---

## Module: `tools/run-skill.ts` — Run Skill Tool

```typescript
import type { ToolDefinition } from '@pen/types';
import { SkillRegistry } from '../registry/skill-registry.js';

export function createRunSkillTool(registry: SkillRegistry): ToolDefinition {
  return {
    name: 'run_skill',
    description: 'Execute a registered skill by ID with optional parameters',
    inputSchema: {
      type: 'object',
      properties: {
        skillId: { type: 'string', description: 'The skill ID to run' },
        params: { type: 'object', description: 'Skill parameters' },
      },
      required: ['skillId'],
    },

    async execute(input) {
      const { skillId, params } = input as {
        skillId: string;
        params?: Record<string, unknown>;
      };

      const skill = registry.get(skillId);
      if (!skill) return { error: `Skill "${skillId}" not found` };

      try {
        const result = await skill.execute(params ?? {});
        return { success: true, result };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}
```

---

## Module: `@pen/branch — types.ts`

```typescript
export interface BranchState {
  id: string;
  parentDocId: string;
  name: string;
  createdAt: number;
  author: string;
  status: 'active' | 'merged' | 'abandoned';
  metadata?: Record<string, unknown>;
}

export interface BranchDiff {
  addedBlocks: string[];
  removedBlocks: string[];
  modifiedBlocks: Array<{
    blockId: string;
    oldText: string;
    newText: string;
  }>;
}

export interface MergeResult {
  success: boolean;
  conflicts?: MergeConflict[];
  mergedOps?: number;
}

export interface MergeConflict {
  blockId: string;
  parentText: string;
  branchText: string;
  type: 'text-conflict' | 'block-deleted' | 'block-moved';
}
```

---

## Module: `fork.ts` — Document Fork

```typescript
import type { Editor, CRDTDocument } from '@pen/types';
import type { BranchState } from './types.js';

export function forkDocument(
  editor: Editor,
  branchName: string,
  config: { docId?: string },
): { branch: BranchState; doc: CRDTDocument } {
  const adapter = editor.internals.adapter;
  const sourceDoc = editor.internals.crdtDoc;

  const branch: BranchState = {
    id: crypto.randomUUID(),
    parentDocId: config.docId ?? 'default',
    name: branchName,
    createdAt: Date.now(),
    author: getLocalUser(editor),
    status: 'active',
  };

  if (!adapter.fork) {
    const state = adapter.encodeState(sourceDoc);
    return { branch, doc: adapter.loadDocument(state) };
  }
  const forkedDoc = adapter.fork(sourceDoc);

  return { branch, doc: forkedDoc };
}

function getLocalUser(editor: Editor): string {
  const awareness = editor.internals.awareness;
  const state = awareness?.getStates().get(awareness?.clientID);
  return state?.user?.name ?? 'Unknown';
}
```

**Delegates to `CRDTAdapter.forkDocument`.** From Wave 1, `forkDocument` creates a full copy of the `Y.Doc` with an independent state vector. Changes to the fork don't affect the parent until an explicit merge.

---

## Module: `merge.ts` — Branch Merge

```typescript
import type { Editor, CRDTDocument } from '@pen/types';
import type { BranchState, MergeResult } from './types.js';

export function mergeDocument(
  editor: Editor,
  branchDoc: CRDTDocument,
  branch: BranchState,
): MergeResult {
  const adapter = editor.internals.adapter;
  const targetDoc = editor.internals.crdtDoc;

  try {
    if (adapter.merge) {
      adapter.merge(targetDoc, branchDoc);
    } else {
      const update = adapter.encodeUpdate(branchDoc);
      adapter.applyUpdate(targetDoc, update);
    }
    branch.status = 'merged';

    return {
      success: true,
    };
  } catch (error) {
    return {
      success: false,
      conflicts: [{
        blockId: 'unknown',
        parentText: '',
        branchText: '',
        type: 'text-conflict',
      }],
    };
  }
}
```

**CRDT merge is conflict-free by nature.** Yjs's merge (`Y.applyUpdate`) handles concurrent edits automatically. The `conflicts` field exists for edge cases where semantic conflicts arise (e.g. both sides delete the same block).

---

## Branch Primitives

### `Pen.Branch.Indicator`

Shows the current branch name and status.

```typescript
interface BranchIndicatorProps {
  children?: React.ReactNode;
  asChild?: boolean;
}

// Data attributes:
// [data-pen-branch-indicator]
// [data-branch-name]
// [data-branch-status]  - 'active' | 'merged' | 'abandoned'
// [data-is-main]        - true when on main document (not a branch)
```

### `Pen.Branch.Switcher`

Dropdown to switch between branches.

```typescript
interface BranchSwitcherProps {
  branches: BranchState[];
  activeBranchId?: string;
  onSwitch: (branchId: string) => void;
  children?: React.ReactNode;
}

// Data attributes:
// [data-pen-branch-switcher]
// [data-branch-count]
```

### `Pen.Branch.MergeDialog`

Confirmation dialog for merging a branch back.

```typescript
interface MergeDialogProps {
  branch: BranchState;
  diff: BranchDiff;
  onMerge: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

// Data attributes:
// [data-pen-branch-merge-dialog]
// [data-has-conflicts]
// [data-change-count]
```

---

## Dependencies

### `@pen/apps`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@pen/react": "workspace:*",
    "react": "^19.0.0"
  }
}
```

### `@pen/execution`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*"
  }
}
```

No external dependencies. Uses Node.js `child_process` and `fs/promises`.

### `@pen/skills`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*"
  }
}
```

### `@pen/branch`

```json
{
  "dependencies": {
    "@pen/core": "workspace:*",
    "@pen/react": "workspace:*",
    "react": "^19.0.0"
  }
}
```

---

## Key Decisions

1. **Three isolation levels.** `none` (direct render — for trusted first-party apps), `error-boundary` (default — crash isolation without iframe overhead), `iframe` (full sandbox — for untrusted third-party apps). The consumer chooses per-app via `defineApp({ isolation })`.

2. **Restricted `AppEditorAPI`.** Apps get a curated read/write API. No selection, no CRDT, no decorations, no extension access. This prevents apps from breaking the editor or leaking internal state.

3. **iframe bridge uses `postMessage` with request/response correlation.** Each request from the iframe includes a `requestId`. The host sends back a response with the same ID. This enables async editor operations from isolated apps.

4. **Path traversal prevention.** All file operations validate that the resolved path stays within the base directory. `../` escape attempts throw immediately.

5. **Output truncation.** Execution output (stdout/stderr) is capped at 100KB. Prevents memory issues from chatty commands or infinite output loops.

6. **SIGTERM → SIGKILL escalation.** Timed-out processes get SIGTERM first, then SIGKILL after 5 seconds. This gives processes a chance to clean up.

7. **Skills return prompts, not direct mutations.** Default skills return `{ type: 'prompt', prompt }` that the AI extension feeds to the model. This keeps the skill framework composable — a skill can leverage the full agentic loop.

8. **Branch = forked `Y.Doc`.** Uses the existing `CRDTAdapter.forkDocument` from Wave 1. The fork is a full copy with an independent state vector. Merge uses `Y.applyUpdate` — conflict-free by CRDT nature.

9. **`onAnchorDeleted` behavior.** When the block that anchors an app is deleted: `'delete'` deletes the app instance, `'orphan'` keeps it floating. Default is `'delete'`.

---

## Acceptance Criteria

1. `defineApp()` creates a valid `AppDefinition` with all required fields.
2. Apps registered via `AppRegistry.register()` are discoverable via `listDefinitions()`.
3. `isolation: 'none'` renders the app component directly in the React tree.
4. `isolation: 'error-boundary'` catches app crashes and renders a fallback.
5. `isolation: 'iframe'` renders the app in an iframe with `postMessage` bridge.
6. iframe apps can read blocks, insert blocks, and update blocks via the bridge.
7. `AppEditorAPI` does not expose selection, CRDT, or decoration internals.
8. `onMount` callback fires when an app instance is created. Return function is called on unmount.
9. `onConfigChange` fires when app config props change.
10. `onAnchorDeleted: 'delete'` deletes the app when its anchor block is deleted.
11. `bash` tool executes shell commands and returns stdout/stderr/exitCode.
12. `bash` tool respects timeout and kills processes after the limit.
13. `write_file` and `read_file` tools validate paths against the base directory.
14. `list_files` returns file entries with names, types, sizes.
15. `upload_to_document` reads a file and inserts it as a code block with inferred language.
16. Path traversal via `../` is rejected with an error.
17. `list_skills` tool returns all registered skills.
18. `get_skill_guide` tool returns the guide text for a specific skill.
19. `run_skill` tool executes a skill and returns its result.
20. Default skills (summarize, translate, generate-toc, proofread) are registered.
21. `forkDocument` creates an independent copy of the document.
22. `mergeDocument` applies branch changes back to the parent document.
23. `Pen.Branch.Indicator` shows current branch name and status.
24. `Pen.Branch.MergeDialog` shows a diff summary before merging.
25. All primitives support `asChild`, forward refs, render no styles, and expose `data-*` attributes.
26. iframe bridge rejects messages when `event.origin !== targetOrigin`.
27. Bridge responses use explicit `targetOrigin` (never `'*'`).
28. `commandMode: 'shell'` is rejected unless `allowShell: true`.
29. Command allow/deny checks are applied to the executable token before spawn.
30. When `allowNetwork: false`, proxy-based network env vars are rejected.
31. Branching remains prototype scope: merge conflict semantics are CRDT-level only; semantic conflict resolution is explicitly out of scope for this wave.

---

## Known Errata (Fix During Implementation)

1. **iframe bridge must validate message payloads.** Add: (a) rate limiting (max N messages/sec per iframe), (b) JSON schema validation of the `payload` field, (c) scope restriction — apps can only modify their own anchor block and blocks they created. Reject any op targeting blocks outside the app's scope.

2. **`splitCommand` must handle quoted arguments.** Replace naive `.split(/\s+/)` with a proper shell-word parser (e.g., `shell-quote` npm package or manual state machine handling `"..."`, `'...'`, and backslash escapes).

3. **`checkPermission` must separate command vs path checks.** The current implementation checks the same `target` string against both command and path patterns. Split into `checkCommandPermission(command, permissions)` and `checkPathPermission(path, permissions)` with distinct calling conventions.

4. **Network isolation requires more than env var checks.** When `allowNetwork === false`, document the limitation: this only removes proxy env vars and is not true network isolation. For true isolation, use the `sandbox-provider.ts` with OS-level sandboxing (e.g., Linux namespaces, macOS sandbox-exec).

5. **Branching needs a persistence story.** `BranchState` is in-memory only. Add `PenPersistence` integration: `saveBranch(branchId, state)`, `loadBranch(branchId)`, `listBranches(docId)`. Without this, all branches are lost on page reload.

6. **Implement `diff.ts` for branch diffing.** `Pen.Branch.MergeDialog` requires a `BranchDiff` prop. Implement by: (a) encoding state vectors for both branch and main, (b) computing delta ops between them, (c) grouping into per-block change summaries.

7. **`editor.internals.doc.id` does not exist.** `PenDocument` has no `id` field. For `forkDocument`, pass the doc ID as a parameter from the branching extension config, not from the document itself.

8. **`AppEditorAPI.readDocument` must use `DocumentState.allBlocks()`** to include layout children, not just `blockOrder`.
