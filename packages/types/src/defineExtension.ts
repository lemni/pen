import type { Extension } from "./types/extension.js";
import type { DocumentState, Editor } from "./types/editor.js";
import type { DecorationSet } from "./types/decorations.js";

type ExtensionCleanup = {
  expose?: Record<string, unknown>;
  destroy?: () => void;
  decorations?: (state: DocumentState) => DecorationSet;
};

type DefineExtensionConfig<TConfig = void> = Omit<
  Extension,
  "version" | "setup"
> & {
  version?: string;
  setup?: TConfig extends void
    ? (editor: Editor) => ExtensionCleanup | void
    : (editor: Editor, config: TConfig) => ExtensionCleanup | void;
};

export function defineExtension<TConfig = void>(
  config: DefineExtensionConfig<TConfig>,
): Extension {
  return {
    version: "0.0.0",
    ...config,
  };
}
