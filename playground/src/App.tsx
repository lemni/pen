import {
	Pen,
	type RendererOverrides,
} from "@pen/react";
import { aiExtension } from "@pen/ai";
import {
	autocompleteExtension,
	getAutocompleteController,
	type AutocompleteAcceptanceStrategy,
	type AutocompleteBlockPolicy,
} from "@pen/ai-autocomplete";
import { createEditor } from "@pen/core";
import type { Editor, InteractionModel } from "@pen/types";
import { inputRulesExtension } from "@pen/input-rules";
import { defaultPreset } from "@pen/preset-default";
import { databaseExtension, databaseRenderers } from "@pen/database";
import { useEffect, useRef, useState, type MutableRefObject } from "react";
import "./App.css";
import { PlaygroundBlockDragHandle } from "./components/BlockDragHandle";
import { PlaygroundImageRenderer } from "./components/ImageBlockRenderer";
import { PlaygroundChatDock } from "./components/PlaygroundChatDock";
import { PlaygroundEditorViewport } from "./components/PlaygroundEditorViewport";
import { usePlaygroundAISession } from "./hooks/usePlaygroundAISession";
import { InspectorPanel } from "./components/InspectorPanel";
import { Toolbar } from "./components/Toolbar";
import { PLAYGROUND_ASSETS, PLAYGROUND_IMPORTERS } from "./constants/playground";
import {
	attachPlaygroundAutocompleteLogging,
	logAutocompleteDebug,
	summarizeAutocompleteState,
} from "./utils/autocompleteDebug";
import { createPlaygroundAIModel } from "./utils/playgroundAI";
import { canOpenLinkEditor } from "./utils/linkMarks";

const PLAYGROUND_RENDERERS = {
	...databaseRenderers,
	image: PlaygroundImageRenderer,
} satisfies RendererOverrides;
const PLAYGROUND_BLOCK_DRAG_AND_DROP = { enabled: true } as const;
const PLAYGROUND_DOCUMENT_PROFILE = "structured" as const;
const PLAYGROUND_AI_CONTENT_FORMAT = {
	blockGeneration: "markdown",
	selectionRewrite: "text",
} as const;
const PLAYGROUND_AI_AUTOCOMPLETE_DEBOUNCE_MS = 220;
const PLAYGROUND_AI_AUTOCOMPLETE_STALE_AFTER_MS = 5000;
const DEFAULT_PLAYGROUND_AUTOCOMPLETE_BLOCK_POLICY: AutocompleteBlockPolicy = {
	allowInCodeBlocks: true,
	allowInTables: false,
	deniedBlockTypes: ["database"],
};

type PlaygroundAutocompleteSettings = {
	enabled: boolean;
	debounceMs: number;
	prefetchAfterAccept: boolean;
	acceptanceStrategy: AutocompleteAcceptanceStrategy;
	blockPolicy: AutocompleteBlockPolicy;
};

export function App() {
	const editorRef = useRef<Editor | null>(null);
	const linkToggleRef = useRef<(() => void) | null>(null);
	const [autocompleteSettings, setAutocompleteSettings] =
		useState<PlaygroundAutocompleteSettings>({
			enabled: true,
			debounceMs: PLAYGROUND_AI_AUTOCOMPLETE_DEBOUNCE_MS,
			prefetchAfterAccept: true,
			acceptanceStrategy: "sequence",
			blockPolicy: DEFAULT_PLAYGROUND_AUTOCOMPLETE_BLOCK_POLICY,
		});
	const editor = usePlaygroundEditor(
		editorRef,
		linkToggleRef,
		autocompleteSettings,
	);
	usePlaygroundAISession(editor);
	const [isInspectorOpen, setIsInspectorOpen] = useState(false);
	const [interactionModel, setInteractionModel] = useState<InteractionModel>("content-first");

	if (!editor) {
		return null;
	}

	const handleToggleInspector = () => {
		setIsInspectorOpen((value) => !value);
	};
	const handleToggleInteractionModel = () => {
		setInteractionModel((current) =>
			current === "content-first" ? "block-first" : "content-first",
		);
	};
	const handleAutocompleteEnabledChange = (enabled: boolean) => {
		setAutocompleteSettings((current) => ({
			...current,
			enabled,
		}));
	};
	const handleAutocompletePrefetchChange = (prefetchAfterAccept: boolean) => {
		setAutocompleteSettings((current) => ({
			...current,
			prefetchAfterAccept,
		}));
	};
	const handleAutocompleteDebounceChange = (debounceMs: number) => {
		setAutocompleteSettings((current) => ({
			...current,
			debounceMs,
		}));
	};
	const handleAutocompleteAcceptanceStrategyChange = (
		acceptanceStrategy: AutocompleteAcceptanceStrategy,
	) => {
		setAutocompleteSettings((current) => ({
			...current,
			acceptanceStrategy,
		}));
	};
	const handleAutocompleteBlockPolicyChange = (
		blockPolicy: Partial<AutocompleteBlockPolicy>,
	) => {
		setAutocompleteSettings((current) => ({
			...current,
			blockPolicy: {
				...current.blockPolicy,
				...blockPolicy,
			},
		}));
	};

	return (
		<Pen.Editor.Root
			editor={editor}
			importers={PLAYGROUND_IMPORTERS}
			assets={PLAYGROUND_ASSETS}
			renderers={PLAYGROUND_RENDERERS}
			blockControls={PlaygroundBlockDragHandle}
			blockDragAndDrop={PLAYGROUND_BLOCK_DRAG_AND_DROP}
			interactionModel={interactionModel}
		>
			<Pen.AI.Root editor={editor}>
				<div className="playground-shell">
					<div className="playground-editor-column">
						<Toolbar
							editor={editor}
							linkToggleRef={linkToggleRef}
							interactionModel={interactionModel}
							onToggleInteractionModel={handleToggleInteractionModel}
							autocompleteEnabled={autocompleteSettings.enabled}
							onAutocompleteEnabledChange={
								handleAutocompleteEnabledChange
							}
						/>
						<PlaygroundEditorViewport editor={editor} />
					</div>
					<div className="playground-side-panel">
						<PlaygroundChatDock editor={editor} />
					</div>
					<InspectorPanel
						editor={editor}
						isOpen={isInspectorOpen}
						onToggle={handleToggleInspector}
						autocompleteSettings={autocompleteSettings}
						onAutocompleteEnabledChange={
							handleAutocompleteEnabledChange
						}
						onAutocompletePrefetchChange={
							handleAutocompletePrefetchChange
						}
						onAutocompleteDebounceChange={
							handleAutocompleteDebounceChange
						}
						onAutocompleteAcceptanceStrategyChange={
							handleAutocompleteAcceptanceStrategyChange
						}
						onAutocompleteBlockPolicyChange={handleAutocompleteBlockPolicyChange}
					/>
				</div>
			</Pen.AI.Root>
		</Pen.Editor.Root>
	);
}

function usePlaygroundEditor(
	editorRef: MutableRefObject<Editor | null>,
	linkToggleRef: MutableRefObject<(() => void) | null>,
	autocompleteSettings: PlaygroundAutocompleteSettings,
): Editor | null {
	const [editor, setEditor] = useState<Editor | null>(null);
	useEffect(() => {
		const nextEditor = createPlaygroundEditor(
			linkToggleRef,
			editorRef,
			autocompleteSettings,
		);
		editorRef.current = nextEditor;
		setEditor(nextEditor);

		return () => {
			if (editorRef.current === nextEditor) {
				editorRef.current = null;
			}
			nextEditor.destroy();
		};
	}, [editorRef, linkToggleRef]);

	useEffect(() => {
		if (!editor) {
			return;
		}
		const controller = getAutocompleteController(editor);
		if (!controller) {
			logAutocompleteDebug("controller missing while applying settings", {
				configuredSettings: autocompleteSettings,
			});
			return;
		}
		attachPlaygroundAutocompleteLogging(controller);
		controller.setEnabled(autocompleteSettings.enabled);
		controller.updateRuntimeSettings({
			debounceMs: autocompleteSettings.debounceMs,
			prefetchAfterAccept: autocompleteSettings.prefetchAfterAccept,
			acceptanceStrategy: autocompleteSettings.acceptanceStrategy,
			staleAfterMs: PLAYGROUND_AI_AUTOCOMPLETE_STALE_AFTER_MS,
		});
		controller.updateBlockPolicy(autocompleteSettings.blockPolicy);
		logAutocompleteDebug("applied settings", {
			configuredSettings: autocompleteSettings,
			runtimeState: summarizeAutocompleteState(controller.getState()),
		});
	}, [autocompleteSettings, editor]);

	return editor;
}

function createPlaygroundEditor(
	linkToggleRef: MutableRefObject<(() => void) | null>,
	editorRef: MutableRefObject<Editor | null>,
	autocompleteSettings: PlaygroundAutocompleteSettings,
): Editor {
	const model = createPlaygroundAIModel(() => editorRef.current);
	return createEditor({
		documentProfile: PLAYGROUND_DOCUMENT_PROFILE,
		preset: defaultPreset({
			shortcuts: {
				onToggleLink: (ed) => {
					if (!canOpenLinkEditor(ed)) return false;
					linkToggleRef.current?.();
					return true;
				},
			},
		}),
		extensions: [
			aiExtension({
				model,
				contentFormat: PLAYGROUND_AI_CONTENT_FORMAT,
			}),
			autocompleteExtension({
				model,
				enabled: autocompleteSettings.enabled,
				debounceMs: autocompleteSettings.debounceMs,
				prefetchAfterAccept: autocompleteSettings.prefetchAfterAccept,
				acceptanceStrategy: autocompleteSettings.acceptanceStrategy,
				staleAfterMs: PLAYGROUND_AI_AUTOCOMPLETE_STALE_AFTER_MS,
				blockPolicy: autocompleteSettings.blockPolicy,
			}),
			inputRulesExtension(),
			databaseExtension(),
		],
	});
}
