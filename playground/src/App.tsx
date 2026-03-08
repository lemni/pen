import "./App.css";
import {
	RICH_TEXT_SHORTCUTS_EXTENSION_NAME,
	richTextShortcutsExtension,
} from "@pen/shortcuts";
import { Pen, useEditor } from "@pen/react";
import { useRef, useState } from "react";
import { InspectorPanel } from "./components/InspectorPanel";
import { SlashMenu } from "./components/SlashMenu";
import { Toolbar } from "./components/Toolbar";
import { PLAYGROUND_IMPORTERS } from "./constants/playground";
import { canOpenLinkEditor } from "./utils/linkMarks";

export function App() {
	const linkToggleRef = useRef<(() => void) | null>(null);
	const editor = useEditor({
		without: [RICH_TEXT_SHORTCUTS_EXTENSION_NAME],
		extensions: [
			richTextShortcutsExtension({
				onToggleLink: (ed) => {
					if (!canOpenLinkEditor(ed)) return false;
					linkToggleRef.current?.();
					return true;
				},
			}),
		],
	});
	const [isInspectorOpen, setIsInspectorOpen] = useState(true);

	return (
		<div className="playground">
			<div className="playground-body">
				<Pen.Editor.Root editor={editor} importers={PLAYGROUND_IMPORTERS}>
					<Toolbar
						editor={editor}
						isInspectorOpen={isInspectorOpen}
						onToggleInspector={() => setIsInspectorOpen((value) => !value)}
						linkToggleRef={linkToggleRef}
					/>

					<div className="playground-editor">
						<Pen.Editor.Content />
						<SlashMenu />
					</div>
				</Pen.Editor.Root>
			</div>

			{isInspectorOpen ? <InspectorPanel editor={editor} /> : null}
		</div>
	);
}
