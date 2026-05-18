# @pen/export-json

Canonical JSON exporter and importer for Pen documents.

## Install

```bash
pnpm add @pen/export-json
```

## What It Provides

- `jsonExporter` for machine-readable document export
- `textExporter` and `exportPlainText()` for plain text export
- `jsonImporter` for importing Pen JSON documents
- shared JSON document types for integration code

Use this package for persistence, interchange, and deterministic round-tripping of supported Pen document content.

## Plain Text

```ts
import {
  exportEditorToText,
  exportPenDocumentToText,
  exportPlainText,
} from "@pen/export-json";

const textFromEditor = exportEditorToText(editor);
const plainText = exportPlainText(editor);
const textFromJson = exportPenDocumentToText(documentJson, {
  excludeBlockTypes: ["quote"],
  separator: " ",
});
```

Hosts can filter block types, render app-specific inline nodes, and extract database block text while keeping product delivery policy outside Pen.
