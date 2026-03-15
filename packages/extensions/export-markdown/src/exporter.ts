import type { Editor, Exporter, ExportOptions } from "@pen/types";
import {
  exportMarkdownForBlocks,
  exportMarkdownRange,
} from "@pen/markdown-serialization";
import type {
  MarkdownExportConfig,
  MarkdownExportRange,
  MarkdownExportViewMode,
} from "@pen/markdown-serialization";

type MarkdownExporterExtraOptions = Record<string, unknown> & {
  range?: MarkdownExportRange;
  viewMode?: MarkdownExportViewMode;
};

export const markdownExporter: Exporter<string, MarkdownExporterExtraOptions> = {
  name: "markdown",
  mimeType: "text/markdown",
  fileExtension: ".md",

  export(editor: Editor, options?: ExportOptions<MarkdownExporterExtraOptions>): string {
    const viewMode =
      options?.extra?.viewMode ??
      (options?.includeSuggestions === false ? "resolved" : "raw");
    const config: MarkdownExportConfig = {
      viewMode,
    };
    const range = options?.extra?.range;
    if (range) {
      return exportMarkdownRange(editor, range, config);
    }
    return exportMarkdownForBlocks(
      editor,
      editor.documentState.allBlocks(),
      config,
    );
  },
};
export { exportMarkdownForBlocks, exportMarkdownRange };
export type {
  MarkdownExportConfig,
  MarkdownExportRange,
  MarkdownExportViewMode,
};
