import type { ReactNode } from "react";

export type SiteSectionId =
  | "getting-started"
  | "guides"
  | "api-reference"
  | "architecture"
  | "examples";

export interface SiteSection {
  id: SiteSectionId;
  title: string;
  description: string;
}

export interface SitePage {
  id: string;
  sectionId: SiteSectionId;
  title: string;
  summary: string;
  content: ReactNode;
}

function codeBlock(code: string): ReactNode {
  return (
    <pre className="docs-code-block">
      <code>{code}</code>
    </pre>
  );
}

export const defaultPageId = "introduction";

export const siteSections: SiteSection[] = [
  {
    id: "getting-started",
    title: "Getting Started",
    description: "Install Pen, understand the package split, and mount a React editor.",
  },
  {
    id: "guides",
    title: "Guides",
    description: "Learn the shipped extension surfaces and integration patterns.",
  },
  {
    id: "api-reference",
    title: "API Reference",
    description: "A concise map of the packages and public surfaces that exist today.",
  },
  {
    id: "architecture",
    title: "Architecture",
    description: "How the headless core, renderers, serialization, and collaboration split fit together.",
  },
  {
    id: "examples",
    title: "Examples",
    description: "Examples only for features that are already shipped in the repository.",
  },
];

export const sitePages: SitePage[] = [
  {
    id: "introduction",
    sectionId: "getting-started",
    title: "Introduction",
    summary: "What Pen is, what ships today, and how to choose the core packages.",
    content: (
      <>
        <p>
          Pen is a headless, extension-first editor engine for human and AI collaboration.
          The core runtime owns document state, selection, operations, and extension hooks.
          Renderers such as React and Vue stay separate from the editing model.
        </p>
        <div className="docs-callout">
          Pen documents the shipped editor surface only: canonical JSON import/export,
          XML interoperability, the React and Vue renderers, and the extension packages
          that are already available in this repository.
        </div>
        <h2>Package roles</h2>
        <ul>
          <li>
            <code>@pen/core</code> creates editors and exposes the runtime entry points.
          </li>
          <li>
            <code>@pen/preset-default</code> packages the standard runtime stack for most
            applications.
          </li>
          <li>
            <code>@pen/react</code> and <code>@pen/vue</code> provide renderer-specific
            component and hook layers.
          </li>
          <li>
            <code>@pen/export-json</code> is the canonical machine format for persistence
            and interchange.
          </li>
          <li>
            <code>@pen/export-xml</code> is the interoperability layer for external
            systems and document pipelines.
          </li>
        </ul>
        <h2>What this docs site covers</h2>
        <ul>
          <li>React-first editor setup</li>
          <li>Schema and extension mental model</li>
          <li>Search, input rules, collaboration, and import/export surfaces</li>
          <li>Architecture and package boundaries</li>
          <li>Only examples for features that are already shipped</li>
        </ul>
        <h2>What it intentionally does not cover</h2>
        <ul>
          <li>Layout, apps, execution, or branch-workflow product surfaces</li>
          <li>Built-in auth or transport ownership</li>
          <li>A second docs stack or speculative package roadmap</li>
        </ul>
      </>
    ),
  },
  {
    id: "react-quick-start",
    sectionId: "getting-started",
    title: "React Quick Start",
    summary: "Install the core packages and mount the minimum viable Pen editor in React.",
    content: (
      <>
        <p>
          React remains the primary quick-start path. Start with the core runtime, the
          default preset, and the React renderer.
        </p>
        <h2>Install</h2>
        {codeBlock(`pnpm add @pen/core @pen/preset-default @pen/react`)}
        <h2>Minimum viable editor</h2>
        {codeBlock(`import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { PenEditor } from "@pen/react";

const editor = createEditor({
  preset: defaultPreset(),
});

export function App() {
  return <PenEditor editor={editor} />;
}`)}
        <h2>When to reach for the default preset</h2>
        <ul>
          <li>
            Use <code>defaultPreset()</code> when you want the standard Pen runtime stack
            with undo, shortcuts, document tools, and delta streaming.
          </li>
          <li>
            Skip the preset and compose <code>extensions</code> directly when you need a
            host-specific runtime surface.
          </li>
        </ul>
        <h2>Next steps</h2>
        <ul>
          <li>Add toolbar and formatting primitives from <code>@pen/react</code></li>
          <li>Opt into markdown-style typing with <code>@pen/input-rules</code></li>
          <li>Add search, collaboration, or export packages as separate concerns</li>
        </ul>
      </>
    ),
  },
  {
    id: "custom-blocks-and-marks",
    sectionId: "guides",
    title: "Custom Blocks And Marks",
    summary: "Extend the schema without coupling Pen to a renderer-specific design system.",
    content: (
      <>
        <p>
          Pen is schema-driven. Block types and inline behaviors live in the schema layer,
          while rendering stays with the host application. That keeps the editor headless
          and lets React and Vue share the same document model.
        </p>
        <h2>Starting point</h2>
        <p>
          The default schema is exported from <code>@pen/schema-default</code>. You can
          use it directly or build from <code>createDefaultSchema()</code> and merge in
          your own block or inline definitions.
        </p>
        {codeBlock(`import {
  createEditor,
  mergeSchemas,
  SchemaRegistryImpl,
} from "@pen/core";
import { createDefaultSchema } from "@pen/schema-default";

const schema = mergeSchemas(
  createDefaultSchema(),
  new SchemaRegistryImpl({
    blocks: [myCustomBlock],
    inlines: [myCustomInline],
  }),
);

const editor = createEditor({ schema });`)}
        <h2>Important boundary</h2>
        <ul>
          <li>Schema definitions describe document behavior and shape.</li>
          <li>Renderer packages decide how those blocks look in React or Vue.</li>
          <li>
            Host apps own the visual design, toolbar choices, menus, and product policy.
          </li>
        </ul>
        <h2>Default schema surface</h2>
        <p>
          The shipped schema exports common blocks such as paragraphs, headings, lists,
          code blocks, images, tables, databases, toggles, dividers, callouts, and
          blockquotes. It also exports inline marks and nodes such as bold, italic,
          underline, strikethrough, code, link, highlight, mention, and inline app nodes.
        </p>
        <div className="docs-callout">
          This guide is intentionally architectural. Pen ships the extension points for
          custom blocks and marks, but it does not impose a single UI composition style for
          every host application.
        </div>
      </>
    ),
  },
  {
    id: "extensions-and-input-rules",
    sectionId: "guides",
    title: "Extensions And Input Rules",
    summary: "Compose runtime features as extensions and opt into markdown autoformat when you want it.",
    content: (
      <>
        <p>
          Pen keeps optional behavior in packages. That includes search, input rules,
          multiplayer, AI, importers, exporters, and document tools. Most apps start with
          <code>defaultPreset()</code> and then add explicit extensions for the features
          they want.
        </p>
        <h2>Opt into input rules</h2>
        {codeBlock(`import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { inputRulesExtension } from "@pen/input-rules";

const editor = createEditor({
  preset: defaultPreset(),
  extensions: [inputRulesExtension()],
});`)}
        <p>
          <code>@pen/input-rules</code> is intentionally not bundled into the default
          preset. Apps that want plain rich-text typing can leave it out.
        </p>
        <h2>What the input rules package adds</h2>
        <ul>
          <li>Heading shortcuts such as <code># </code> through <code>###### </code></li>
          <li>Bullet, numbered, and checklist prefixes</li>
          <li>Blockquote, divider, callout, and code-block triggers</li>
          <li>
            Inline shortcuts for bold, italic, code, strikethrough, and highlight marks
          </li>
        </ul>
        <h2>Extension composition rule of thumb</h2>
        <ul>
          <li>
            Use the preset for the baseline runtime, then add explicit feature packages on
            top.
          </li>
          <li>
            Treat extensions as runtime concerns, not renderer concerns, whenever the
            feature is fundamentally headless.
          </li>
          <li>
            Keep host-specific UI in the renderer layer rather than the core extension.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "collaboration-and-search",
    sectionId: "guides",
    title: "Collaboration And Search",
    summary: "Use transport-agnostic collaboration primitives and the headless search controller.",
    content: (
      <>
        <h2>Collaboration</h2>
        <p>
          <code>@pen/multiplayer</code> owns editor-facing collaboration behavior:
          awareness, peer derivation, controller state, and multiplayer decorations. It
          does not own auth, reconnect strategy, or transport.
        </p>
        <p>
          The recommended Yjs setup is:
        </p>
        <ul>
          <li>
            <code>@pen/multiplayer</code> for the extension and controller state
          </li>
          <li>
            <code>@pen/crdt-yjs</code> for Yjs integration helpers
          </li>
          <li>
            An external provider such as <code>y-websocket</code> for transport
          </li>
        </ul>
        {codeBlock(`import { createEditor } from "@pen/core";
import { multiplayerExtension } from "@pen/multiplayer";
import { createYWebsocketSessionFactory } from "./createYWebsocketSessionFactory";

const editor = createEditor({
  extensions: [
    multiplayerExtension({
      user: { id: "u1", name: "Ada" },
      sessionFactory: createYWebsocketSessionFactory({
        serverUrl: "ws://localhost:1234",
        room: "room-a",
      }),
    }),
  ],
});`)}
        <h2>Search</h2>
        <p>
          Search is split into a headless extension and renderer-level UI. Add
          <code>@pen/search</code> to install the controller and match decorations.
        </p>
        {codeBlock(`import { createEditor } from "@pen/core";
import { defaultPreset } from "@pen/preset-default";
import { searchExtension } from "@pen/search";

const editor = createEditor({
  preset: defaultPreset(),
  extensions: [searchExtension()],
});`)}
        <p>
          In React, the search controller can be consumed through <code>useSearch()</code>
          and the <code>Pen.Search</code> primitives. Vue currently focuses on the core
          editor proof and does not yet ship a dedicated search primitive set.
        </p>
      </>
    ),
  },
  {
    id: "exporters-and-importers",
    sectionId: "guides",
    title: "Exporters And Importers",
    summary: "Use JSON as the canonical machine format and XML as the interoperability layer.",
    content: (
      <>
        <p>
          Pen uses JSON as its canonical machine-readable format and XML as a secondary
          interoperability surface. Markdown and HTML import/export still exist for
          human-oriented workflows.
        </p>
        <h2>JSON</h2>
        <ul>
          <li>
            <code>@pen/export-json</code> exports a full-fidelity, versioned document
            representation.
          </li>
          <li>
            The importer recreates blocks, text content, inline marks, nested children,
            tables, and database content.
          </li>
        </ul>
        {codeBlock(`import { exportEditorToJson, jsonImporter } from "@pen/export-json";

const snapshot = exportEditorToJson(editor);
jsonImporter.import(snapshot, editor, { replace: true });`)}
        <h2>XML</h2>
        <ul>
          <li>
            <code>@pen/export-xml</code> builds on top of the JSON representation rather
            than inventing a second document model.
          </li>
          <li>
            Use XML when integrating with external systems that need a structured
            document-oriented interchange format.
          </li>
        </ul>
        {codeBlock(`import { xmlExporter, xmlImporter } from "@pen/export-xml";

const xml = xmlExporter.export(editor);
xmlImporter.import(xml, editor, { replace: true });`)}
        <h2>Design rule</h2>
        <div className="docs-callout">
          JSON is the source of truth for persistence and machine interchange. XML is a
          compatibility surface, not Pen&apos;s internal state model.
        </div>
      </>
    ),
  },
  {
    id: "packages-and-surfaces",
    sectionId: "api-reference",
    title: "Packages And Public Surfaces",
    summary: "A concise map of the packages that are stable enough to integrate today.",
    content: (
      <>
        <p>
          This is intentionally a compact reference page. It documents the shipped
          surfaces that exist today, not generated symbol-by-symbol API docs.
        </p>
        <div className="docs-package-grid">
          <article className="docs-package-card">
            <h2>@pen/core</h2>
            <p>Create editors, manage document state, and access schema/runtime entry points.</p>
          </article>
          <article className="docs-package-card">
            <h2>@pen/preset-default</h2>
            <p>The standard runtime stack for most embedded applications.</p>
          </article>
          <article className="docs-package-card">
            <h2>@pen/react</h2>
            <p>React renderer, hooks, toolbar/search primitives, and editor composition APIs.</p>
          </article>
          <article className="docs-package-card">
            <h2>@pen/vue</h2>
            <p>Vue renderer proof with editor components, composables, plugin registration, typing, selection, and paste support.</p>
          </article>
          <article className="docs-package-card">
            <h2>@pen/search</h2>
            <p>Headless search controller, document match logic, replacement helpers, and decorations.</p>
          </article>
          <article className="docs-package-card">
            <h2>@pen/input-rules</h2>
            <p>Opt-in markdown-style typing shortcuts and autoformat behavior.</p>
          </article>
          <article className="docs-package-card">
            <h2>@pen/multiplayer</h2>
            <p>Transport-agnostic collaboration state, awareness, and remote selection decorations.</p>
          </article>
          <article className="docs-package-card">
            <h2>@pen/crdt-yjs</h2>
            <p>Yjs adapter and interoperability helpers for collaborative setups.</p>
          </article>
          <article className="docs-package-card">
            <h2>@pen/export-json / @pen/export-xml</h2>
            <p>Canonical JSON persistence plus XML interoperability.</p>
          </article>
        </div>
      </>
    ),
  },
  {
    id: "architecture-overview",
    sectionId: "architecture",
    title: "Architecture Overview",
    summary: "How the runtime, renderers, serialization, and collaboration layers fit together.",
    content: (
      <>
        <p>
          Pen is designed so that the document model and operation pipeline are renderer
          agnostic. React and Vue prove the same editor runtime can be mounted through
          different component systems without forking the document semantics.
        </p>
        <h2>Core split</h2>
        <ul>
          <li>
            <strong>Schema layer:</strong> block and inline definitions, normalization, and
            content rules
          </li>
          <li>
            <strong>Core runtime:</strong> editor state, selection, extension hooks,
            history, and mutation pipeline
          </li>
          <li>
            <strong>DOM engine:</strong> shared field-editor behavior extracted into
            <code>@pen/dom</code>
          </li>
          <li>
            <strong>Renderers:</strong> React and Vue packages that compose the headless
            editor into framework-native components and hooks
          </li>
          <li>
            <strong>Serialization:</strong> JSON as the canonical machine format, XML as
            interoperability, markdown and HTML for user-facing exchange
          </li>
        </ul>
        <h2>Why this matters</h2>
        <ul>
          <li>Host apps keep ownership of auth, transport, and product policy.</li>
          <li>Renderer packages stay lean instead of reimplementing the core.</li>
          <li>Extensions can remain headless when the feature does not need a UI opinion.</li>
          <li>Persistence format decisions do not leak into renderer architecture.</li>
        </ul>
      </>
    ),
  },
  {
    id: "shipped-examples",
    sectionId: "examples",
    title: "Shipped Examples",
    summary: "Examples and references that map directly to code already in this repository.",
    content: (
      <>
        <p>
          The examples section intentionally links only to surfaces that are already
          shipped. It does not document deferred roadmap areas.
        </p>
        <h2>Repository examples</h2>
        <ul>
          <li>
            <strong>Playground:</strong> the main repository app for React-first editor
            integration and feature experimentation
          </li>
          <li>
            <strong>Playground collaboration wiring:</strong> the repository&apos;s concrete
            <code>y-websocket</code> session wiring lives in{" "}
            <code>playground/src/utils/playgroundCollaboration.ts</code>
          </li>
          <li>
            <strong>Vue renderer package:</strong> reference implementation for the
            non-React rendering split
          </li>
        </ul>
        <h2>Suggested adoption path</h2>
        <ol>
          <li>Start with the React quick start and default preset.</li>
          <li>Add only the runtime extensions your host app needs.</li>
          <li>Choose JSON for persistence and XML only when interoperability requires it.</li>
          <li>Adopt multiplayer through transport-agnostic session wiring.</li>
        </ol>
      </>
    ),
  },
];
