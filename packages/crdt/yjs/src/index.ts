export { yjsAdapter } from "./adapter";
export type { YjsAdapterOptions, CRDTDiagnostic } from "./adapter";
export {
  applyYjsAwarenessUpdate,
  createYjsAwareness,
  encodeYjsAwarenessUpdate,
  getYjsAwareness,
} from "./awareness";
export type { YjsAwareness } from "./awareness";
export {
  createYjsProviderSession,
  getYjsDoc,
} from "./collaboration/providerSession";
export type {
  YjsProviderAdapter,
  YjsProviderStatus,
} from "./collaboration/providerSession";
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
export {
  compareYjsStateVectorBase64,
  compareYjsStateVectors,
  decodeYjsStateVectorBase64,
  encodeYjsStateVector,
  encodeYjsStateVectorBase64,
  isYjsStateVectorBase64Satisfied,
  isYjsStateVectorSatisfied,
} from "./stateVector";
export type {
  YjsStateVectorComparison,
  YjsStateVectorMissingClient,
} from "./stateVector";
export {
  createYArrayFieldAdapter,
  createYTextFieldAdapter,
} from "./fieldAdapters";
export type {
  CreateYArrayFieldAdapterOptions,
  CreateYTextFieldAdapterOptions,
  YArrayFieldAdapter,
  YTextFieldAdapter,
  YjsFieldObserver,
  YjsFieldUnsubscribe,
} from "./fieldAdapters";
export {
  YjsExtensionRootError,
  ensureExtensionRoot,
  readExtensionRoot,
} from "./extensionRoots";
export type {
  YjsExtensionRoot,
  YjsExtensionRootFieldType,
  YjsExtensionRootOptions,
  YjsExtensionRootReadOptions,
  YjsExtensionRootShape,
} from "./extensionRoots";
