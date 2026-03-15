import { Pen } from "@pen/react";
import type { Editor } from "@pen/types";
import { useRef } from "react";
import { PlaygroundContextualPrompt } from "./PlaygroundContextualPrompt";
import { SelectionToolbar } from "./SelectionToolbar";
import { SlashMenu } from "./SlashMenu";

type PlaygroundEditorViewportProps = {
	editor: Editor;
};

export function PlaygroundEditorViewport({
	editor,
}: PlaygroundEditorViewportProps) {
	const viewportRef = useRef<HTMLDivElement | null>(null);

	const getViewportRect = () => {
		return viewportRef.current?.getBoundingClientRect() ?? null;
	};

	return (
		<div className="playground-editor-viewport" ref={viewportRef}>
			<Pen.Editor.Content
				emptyPlaceholder="Start writing, or press / for commands..."
			/>
			<PlaygroundContextualPrompt viewportRef={viewportRef} />
			<Pen.Editor.RegionSelector getRegionRect={getViewportRect} />
			<Pen.Editor.SelectionRect />
			<SlashMenu editor={editor} />
			<SelectionToolbar />
			<Pen.AI.InlineSuggestionControls>
				<Pen.AI.InlineSuggestionFloatingSurface>
					<div data-pen-ai-inline-suggestion-nav="">
						<Pen.AI.InlineSuggestionPrevious />
						<Pen.AI.InlineSuggestionCount />
						<Pen.AI.InlineSuggestionNext />
					</div>
					<Pen.AI.InlineSuggestionReject />
					<Pen.AI.InlineSuggestionAccept />
				</Pen.AI.InlineSuggestionFloatingSurface>
			</Pen.AI.InlineSuggestionControls>
		</div>
	);
}
