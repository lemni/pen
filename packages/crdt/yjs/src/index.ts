export { yjsAdapter } from "./adapter";
export type { YjsAdapterOptions, CRDTDiagnostic } from "./adapter";
export {
  createYjsSubdocument,
  getDocumentProfile,
  initBlockMap,
  isYjsDoc,
  isYjsMap,
  isYjsCRDTDocument,
  setDocumentProfile,
  wrapYjsDocument,
  validateDocument,
  DOCUMENT_PROFILE,
  SUBDOCUMENT,
} from "./document";
export type {
  BlockContentType,
  YjsCRDTDocument,
  YjsDoc,
  YjsMap,
  YjsPenDocument,
  DocumentValidationResult,
  DocumentValidationError,
} from "./document";
