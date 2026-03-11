import {
	Pen,
	type RendererOverrides,
	useEditor,
} from "@pen/react";
import type { InteractionModel } from "@pen/core";
import { inputRulesExtension } from "@pen/input-rules";
import { databaseExtension, databaseRenderers } from "@pen/database";
import {
	RICH_TEXT_SHORTCUTS_EXTENSION_NAME,
	richTextShortcutsExtension,
} from "@pen/shortcuts";
import { useRef, useState } from "react";
import "./App.css";
import { PlaygroundBlockDragHandle } from "./components/BlockDragHandle";
import { PlaygroundImageRenderer } from "./components/ImageBlockRenderer";
import { InspectorPanel } from "./components/InspectorPanel";
import { SelectionToolbar } from "./components/SelectionToolbar";
import { SlashMenu } from "./components/SlashMenu";
import { Toolbar } from "./components/Toolbar";
import { PLAYGROUND_ASSETS, PLAYGROUND_IMPORTERS } from "./constants/playground";
import { canOpenLinkEditor } from "./utils/linkMarks";

const PLAYGROUND_RENDERERS = {
	...databaseRenderers,
	image: PlaygroundImageRenderer,
} satisfies RendererOverrides;
const PLAYGROUND_BLOCK_DRAG_AND_DROP = { enabled: true } as const;
const PLAYGROUND_DOCUMENT_PROFILE = "structured" as const;

export function App() {
	const editor = useEditor({
		documentProfile: PLAYGROUND_DOCUMENT_PROFILE,
		without: [RICH_TEXT_SHORTCUTS_EXTENSION_NAME],
		extensions: [
			inputRulesExtension(),
			databaseExtension(),
			richTextShortcutsExtension({
				onToggleLink: (ed) => {
					if (!canOpenLinkEditor(ed)) return false;
					linkToggleRef.current?.();
					return true;
				},
			}),
		],
	});
	const linkToggleRef = useRef<(() => void) | null>(null);
	const playgroundRef = useRef<HTMLDivElement | null>(null);
	const [isInspectorOpen, setIsInspectorOpen] = useState(false);
	const [interactionModel, setInteractionModel] = useState<InteractionModel>("content-first");

	const handleToggleInspector = () => {
		setIsInspectorOpen((value) => !value);
	};
	const handleToggleInteractionModel = () => {
		setInteractionModel((current) =>
			current === "content-first" ? "block-first" : "content-first",
		);
	};
	const getPlaygroundSelectionRegion = () => {
		return playgroundRef.current?.getBoundingClientRect() ?? null;
	};

	return (
		<div className="playground" ref={playgroundRef}>
			<div className="playground-body">
				<Pen.Editor.Root
					editor={editor}
					importers={PLAYGROUND_IMPORTERS}
					assets={PLAYGROUND_ASSETS}
					renderers={PLAYGROUND_RENDERERS}
					blockControls={PlaygroundBlockDragHandle}
					blockDragAndDrop={PLAYGROUND_BLOCK_DRAG_AND_DROP}
					interactionModel={interactionModel}
				>
					<Toolbar
						editor={editor}
						linkToggleRef={linkToggleRef}
						interactionModel={interactionModel}
						onToggleInteractionModel={handleToggleInteractionModel}
					/>

					<div className="playground-editor">
						<Pen.Editor.Content
							emptyPlaceholder="Start writing, or press / for commands..."
						/>
						<Pen.Editor.RegionSelector
							getRegionRect={getPlaygroundSelectionRegion}
						/>
						<Pen.Editor.SelectionRect />
						<SlashMenu editor={editor} />
						<SelectionToolbar />
					</div>
				</Pen.Editor.Root>
			</div>

			<InspectorPanel
				editor={editor}
				isOpen={isInspectorOpen}
				onToggle={handleToggleInspector}
			/>
		</div>
	);
}
