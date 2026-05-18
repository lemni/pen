import {
	FieldEditorImpl,
	handleEditorDocumentKeyDown,
	resolveSelectAllBehavior,
	shouldHandleEditorKeyboardEvent as shouldHandlePenEditorKeyboardEvent,
} from "@pen/dom";
import { domSelectionToEditor } from "@pen/dom/field-editor/selectionBridge";
import { DATA_ATTRS } from "@pen/dom/utils/dataAttributes";
import type {
	AssetProvider,
	Editor,
	InteractionModel,
} from "@pen/types";
import { FIELD_EDITOR_SLOT_KEY as CORE_FIELD_EDITOR_SLOT_KEY } from "@pen/types";
import {
	defineComponent,
	h,
	mergeProps,
	onBeforeUnmount,
	ref,
	toRef,
	watch,
	type ComponentPublicInstance,
	type PropType,
} from "vue";
import { FIELD_EDITOR_SLOT_KEY } from "../constants/fieldEditor";
import { useDocumentEmptyState } from "../internal/editorState";
import { provideEditorContext } from "../internal/editorContext";
import {
	provideFieldEditorContext,
	type VueFieldEditor,
} from "../internal/fieldEditorContext";
import type { PasteImporters, RendererOverrides } from "../types";
import { PenContent } from "./PenContent";

export const PenEditor = defineComponent({
	name: "PenEditor",
	props: {
		editor: {
			type: Object as PropType<Editor>,
			required: true,
		},
		readonly: {
			type: Boolean,
			default: false,
		},
		interactionModel: {
			type: String as PropType<InteractionModel | undefined>,
			default: undefined,
		},
		importers: {
			type: Object as PropType<PasteImporters | undefined>,
			default: undefined,
		},
		assets: {
			type: Object as PropType<AssetProvider | undefined>,
			default: undefined,
		},
		emptyPlaceholder: {
			type: String,
			default: undefined,
		},
		renderers: {
			type: Object as PropType<RendererOverrides | undefined>,
			default: undefined,
		},
	},
	setup(props, { attrs, slots }) {
		const focused = ref(false);
		const rootElement = ref<HTMLElement | null>(null);
		const readonlyRef = toRef(props, "readonly");
		const emptyPlaceholderRef = toRef(props, "emptyPlaceholder");
		const renderersRef = toRef(props, "renderers");
		const fieldEditor = new FieldEditorImpl(props.editor, {
			selectAllBehavior: resolveSelectAllBehavior(
				props.interactionModel ?? "content-first",
			),
		}) as VueFieldEditor;
		const isDocumentEmpty = useDocumentEmptyState(props.editor);

		provideEditorContext({
			editor: props.editor,
			readonly: readonlyRef,
			emptyPlaceholder: emptyPlaceholderRef,
			renderers: renderersRef,
		});
		provideFieldEditorContext(fieldEditor);

		props.editor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, fieldEditor);
		props.editor.internals.setSlot(CORE_FIELD_EDITOR_SLOT_KEY, fieldEditor);

		watch(
			() => props.interactionModel,
			(interactionModel) => {
				fieldEditor.setSelectAllBehavior(
					resolveSelectAllBehavior(interactionModel ?? "content-first"),
				);
			},
		);

		watch(
			rootElement,
			(nextElement, _previousElement, onCleanup) => {
				fieldEditor.setRootElement(nextElement);
				if (!nextElement) {
					focused.value = false;
					fieldEditor.setFocused(false);
					return;
				}

				const ownerDocument = nextElement.ownerDocument;
				const handleFocusIn = () => {
					focused.value = true;
					fieldEditor.setFocused(true);
				};

				const handleFocusOut = () => {
					const activeElement =
						nextElement.ownerDocument?.activeElement;
					const nextFocused =
						activeElement instanceof Node &&
						nextElement.contains(activeElement);
					focused.value = nextFocused;
					fieldEditor.setFocused(nextFocused);
				};

				const handleKeyDown = (event: KeyboardEvent) => {
					if (
						!shouldHandlePenEditorKeyboardEvent({
							root: nextElement,
							event,
							selection: props.editor.selection,
							hasMappedDomSelection: () =>
								domSelectionToEditor(nextElement) !== null,
						})
					) {
						return;
					}

					if (
						handleEditorDocumentKeyDown({
							event,
							editor: props.editor,
							fieldEditor,
							interactionModel:
								props.interactionModel ?? "content-first",
							root: nextElement,
						})
					) {
						event.preventDefault();
						event.stopImmediatePropagation();
						return;
					}
				};

				nextElement.addEventListener("focusin", handleFocusIn);
				nextElement.addEventListener("focusout", handleFocusOut);
				ownerDocument?.addEventListener("keydown", handleKeyDown, true);
				onCleanup(() => {
					nextElement.removeEventListener("focusin", handleFocusIn);
					nextElement.removeEventListener("focusout", handleFocusOut);
					ownerDocument?.removeEventListener(
						"keydown",
						handleKeyDown,
						true,
					);
				});
			},
			{ immediate: true },
		);

		watch(
			() => [props.importers, props.assets] as const,
			([importers, assets]) => {
				props.editor.internals.setSlot("paste:importers", importers);
				props.editor.internals.setSlot(
					"paste:assetProvider",
					assets ?? importers?.assets,
				);
			},
			{ immediate: true },
		);

		onBeforeUnmount(() => {
			props.editor.internals.setSlot(FIELD_EDITOR_SLOT_KEY, undefined);
			props.editor.internals.setSlot(
				CORE_FIELD_EDITOR_SLOT_KEY,
				undefined,
			);
			props.editor.internals.setSlot("paste:importers", undefined);
			props.editor.internals.setSlot("paste:assetProvider", undefined);
			fieldEditor.setRootElement(null);
			fieldEditor.destroy();
		});

		return () => {
			const children = slots.default ? slots.default() : [h(PenContent)];

			return h(
				"div",
				mergeProps(attrs, {
					ref: (
						element: Element | ComponentPublicInstance | null,
					) => {
						rootElement.value =
							element instanceof HTMLElement ? element : null;
					},
					[DATA_ATTRS.editorRoot]: "",
					[DATA_ATTRS.viewId]: props.editor.internals.viewId,
					[DATA_ATTRS.focused]: focused.value || undefined,
					[DATA_ATTRS.readonly]: props.readonly || undefined,
					[DATA_ATTRS.empty]: isDocumentEmpty.value || undefined,
					tabIndex: -1,
				}),
				children,
			);
		};
	},
});

export type PenEditorProps = InstanceType<typeof PenEditor>["$props"];
