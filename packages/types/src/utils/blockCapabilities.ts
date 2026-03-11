import type { DocumentProfile } from "../types/crdt";
import type { BlockAuthoring, BlockSelectionRole, FlowBlockCapability } from "../types/schema";

type BlockSchemaCapabilityLike =
  | {
      authoring?: BlockAuthoring;
      content?: string | unknown[];
      display?: { hidden?: boolean };
      fieldEditor?: string;
    }
  | null
  | undefined;

export function getFlowCapabilityFromSchema(
  schema: BlockSchemaCapabilityLike,
): FlowBlockCapability | null {
  if (!schema) {
    return null;
  }

  if (schema.authoring?.flowCapability) {
    return schema.authoring.flowCapability;
  }

  if (schema.content === "database" || schema.fieldEditor === "database") {
    return "flow-disallowed";
  }

  if (
    schema.content === "table" ||
    schema.content === "subdocument" ||
    schema.fieldEditor === "table" ||
    schema.fieldEditor === "subdocument"
  ) {
    return "flow-delegated";
  }

  if (schema.content === "inline") {
    return "flow-inline";
  }

  if (schema.fieldEditor === "none" || schema.content === "none") {
    return "flow-structural";
  }

  return "flow-delegated";
}

export function getBlockSelectionRoleFromSchema(
  schema: BlockSchemaCapabilityLike,
): BlockSelectionRole | null {
  if (!schema) {
    return null;
  }

  if (schema.authoring?.selectionRole) {
    return schema.authoring.selectionRole;
  }

  if (schema.fieldEditor === "none") {
    return "structural";
  }

  if (schema.content === "inline") {
    return "editable-inline";
  }

  return "delegated";
}

type LegacyBlockType =
  | "codeBlock"
  | "database"
  | "divider"
  | "image"
  | "subdocument"
  | "table";

function isLegacyBlockType(value: string): value is LegacyBlockType {
  return (
    value === "codeBlock" ||
    value === "database" ||
    value === "divider" ||
    value === "image" ||
    value === "subdocument" ||
    value === "table"
  );
}

export function getFlowCapabilityFromType(
  blockType: string | null | undefined,
): FlowBlockCapability | null {
  if (!blockType) {
    return null;
  }

  if (!isLegacyBlockType(blockType)) {
    return null;
  }

  switch (blockType) {
    case "codeBlock":
      return "flow-inline";
    case "subdocument":
    case "table":
      return "flow-delegated";
    case "database":
      return "flow-disallowed";
    case "divider":
    case "image":
      return "flow-structural";
  }
  return null;
}

export function shouldFallbackMixedSelectionToBlock(
  documentProfile: DocumentProfile,
  capability: FlowBlockCapability | null,
): boolean {
  if (!capability) {
    return true;
  }

  if (documentProfile === "structured") {
    return capability !== "flow-inline";
  }

  return (
    capability === "flow-structural" || capability === "flow-disallowed"
  );
}

export function shouldForceBlockScopedSelectAll(
  documentProfile: DocumentProfile,
  capability: FlowBlockCapability | null,
): boolean {
  return (
    documentProfile === "flow" &&
    (capability === "flow-structural" || capability === "flow-disallowed")
  );
}

export function isContinuousTextFlowCapability(
  capability: FlowBlockCapability | null,
): boolean {
  return capability === "flow-inline";
}

export function shouldAllowFlowInsertionInSlashMenu(
  documentProfile: DocumentProfile,
  capability: FlowBlockCapability | null,
): boolean {
  if (documentProfile !== "flow") {
    return true;
  }

  return capability !== "flow-disallowed";
}

export function shouldShowBlockInDefaultMenus(
  documentProfile: DocumentProfile,
  schema: BlockSchemaCapabilityLike,
): boolean {
  // Authoring visibility helper for user-facing insertion surfaces such as
  // slash menus and default toolbar block pickers. This is intentionally
  // narrower than document serialization: hidden/system blocks may still exist
  // in a document and should still export if present.
  if (!schema) {
    return false;
  }

  if (schema.display?.hidden) {
    return false;
  }

  if (schema.content === "subdocument" || schema.fieldEditor === "subdocument") {
    return false;
  }

  return shouldAllowFlowInsertionInSlashMenu(
    documentProfile,
    getFlowCapabilityFromSchema(schema),
  );
}

export function shouldExposeBlockInTooling(
  documentProfile: DocumentProfile,
  schema: BlockSchemaCapabilityLike,
): boolean {
  // Authoring visibility helper for programmatic write surfaces. Tooling should
  // only offer block types that are valid insertion targets for the active
  // documentProfile; this does not mean existing document content is invalid to
  // export or preserve.
  if (!schema) {
    return false;
  }

  if (schema.display?.hidden) {
    return false;
  }

  return shouldAllowFlowInsertionInSlashMenu(
    documentProfile,
    getFlowCapabilityFromSchema(schema),
  );
}

export function shouldAllowDirectBlockPaste(
  documentProfile: DocumentProfile,
  capability: FlowBlockCapability | null,
): boolean {
  // Fast-path block payload acceptance for direct paste authoring. Unknown or
  // flow-disallowed blocks must fall back to importer/normalization paths
  // rather than being treated as safe insertion surfaces.
  if (documentProfile !== "flow") {
    return true;
  }

  return capability !== null && capability !== "flow-disallowed";
}

export function getBlockSelectionRoleFromType(
  blockType: string | null | undefined,
): BlockSelectionRole {
  if (!blockType) {
    return "editable-inline";
  }

  if (!isLegacyBlockType(blockType)) {
    return "editable-inline";
  }

  switch (blockType) {
    case "divider":
    case "image":
      return "structural";
    case "codeBlock":
    case "database":
    case "subdocument":
    case "table":
      return "delegated";
  }

  return "editable-inline";
}
