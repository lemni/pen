import React, { createContext, useContext, useEffect, useRef } from "react";
import type { Editor } from "@pen/types";
import { EditorContext } from "../../context/editorContext";
import {
	useSuggestionMenu,
	type SuggestionMenuActions,
	type SuggestionMenuController,
	type SuggestionMenuState,
	type UseSuggestionMenuOptions,
} from "../../hooks/useSuggestionMenu";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { isDevelopmentEnvironment } from "../../utils/environment";

export type SuggestionMenuContextValue<TItem = unknown> =
	SuggestionMenuState<TItem> &
		SuggestionMenuActions & {
			editor?: Editor;
		};

const SuggestionMenuContext =
	createContext<SuggestionMenuContextValue<unknown> | null>(null);

export function useSuggestionMenuContext<
	TItem = unknown,
>(): SuggestionMenuContextValue<TItem> {
	const context = useContext(SuggestionMenuContext);
	if (!context) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: useSuggestionMenuContext must be used within <Pen.SuggestionMenu.Root>.",
			);
		}
		throw new Error("Missing Pen.SuggestionMenu.Root context");
	}
	return context as SuggestionMenuContextValue<TItem>;
}

export interface SuggestionMenuRootProps<TItem = unknown> extends AsChildProps {
	controller?: SuggestionMenuController<TItem>;
	editor?: Editor;
	options?: UseSuggestionMenuOptions<TItem>;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	ref?: React.Ref<HTMLElement>;
}

export function SuggestionMenuRoot<TItem = unknown>(
	props: SuggestionMenuRootProps<TItem>,
) {
	const { controller, editor, options, ...rest } = props;
	if (controller) {
		return (
			<SuggestionMenuRootContent
				{...rest}
				controller={controller}
				editor={editor}
			/>
		);
	}
	if (options) {
		return (
			<UncontrolledSuggestionMenuRoot
				{...rest}
				editor={editor}
				options={options}
			/>
		);
	}

	if (isDevelopmentEnvironment()) {
		console.error(
			"Pen: <Pen.SuggestionMenu.Root> requires either controller or options.",
		);
	}
	throw new Error("Missing Pen.SuggestionMenu.Root controller");
}

type UncontrolledSuggestionMenuRootProps<TItem> = Omit<
	SuggestionMenuRootProps<TItem>,
	"controller"
> & {
	options: UseSuggestionMenuOptions<TItem>;
};

function UncontrolledSuggestionMenuRoot<TItem>(
	props: UncontrolledSuggestionMenuRootProps<TItem>,
) {
	const { editor: editorProp, options, ...rest } = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? options.editor ?? editorContext?.editor;

	if (!editor) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: <Pen.SuggestionMenu.Root> must be used within <Pen.Editor.Root>, receive editor, or receive options.editor.",
			);
		}
		throw new Error("Missing editor for Pen.SuggestionMenu.Root");
	}

	const controller = useSuggestionMenu({
		...options,
		editor,
	});

	return (
		<SuggestionMenuRootContent
			{...rest}
			controller={controller}
			editor={editor}
		/>
	);
}

type SuggestionMenuRootContentProps<TItem> = Omit<
	SuggestionMenuRootProps<TItem>,
	"controller" | "editor" | "options"
> & {
	controller: SuggestionMenuController<TItem>;
	editor?: Editor;
};

function SuggestionMenuRootContent<TItem>(
	props: SuggestionMenuRootContentProps<TItem>,
) {
	const {
		controller,
		editor: editorProp,
		open: controlledOpen,
		onOpenChange,
		...rest
	} = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? editorContext?.editor;
	const isOpen = controlledOpen ?? controller.open;

	const wrappedState: SuggestionMenuContextValue<TItem> = {
		...controller,
		editor,
		open: isOpen,
		dismiss: () => {
			controller.dismiss();
			onOpenChange?.(false);
		},
		confirm: (index?: number) => {
			const didConfirm = controller.confirm(index);
			if (didConfirm) {
				onOpenChange?.(false);
			}
			return didConfirm;
		},
	};
	const wrappedStateRef = useRef(wrappedState);
	wrappedStateRef.current = wrappedState;

	useEffect(() => {
		if (!isOpen) {
			return;
		}

		const handleKeyDown = (event: KeyboardEvent) => {
			const currentState = wrappedStateRef.current;
			if (event.metaKey || event.ctrlKey || event.altKey) {
				return;
			}

			switch (event.key) {
				case "ArrowDown": {
					event.preventDefault();
					event.stopPropagation();
					const nextIndex =
						currentState.items.length === 0
							? 0
							: (currentState.selectedIndex + 1) %
								currentState.items.length;
					wrappedStateRef.current = {
						...currentState,
						selectedIndex: nextIndex,
					};
					currentState.select(nextIndex);
					break;
				}
				case "ArrowUp": {
					event.preventDefault();
					event.stopPropagation();
					const nextIndex =
						currentState.items.length === 0
							? 0
							: (currentState.selectedIndex -
									1 +
									currentState.items.length) %
								currentState.items.length;
					wrappedStateRef.current = {
						...currentState,
						selectedIndex: nextIndex,
					};
					currentState.select(nextIndex);
					break;
				}
				case "Enter":
				case "Tab":
					event.preventDefault();
					event.stopPropagation();
					currentState.confirm(currentState.selectedIndex);
					break;
				case "Escape":
					event.preventDefault();
					event.stopPropagation();
					currentState.dismiss();
					break;
			}
		};

		document.addEventListener("keydown", handleKeyDown, true);
		return () => {
			document.removeEventListener("keydown", handleKeyDown, true);
		};
	}, [isOpen]);

	const primitiveProps: Record<string, unknown> = {
		role: "dialog",
		"data-pen-suggestion-menu": "",
		"data-open": isOpen || undefined,
		"data-trigger": controller.target?.trigger,
	};

	return (
		<SuggestionMenuContext.Provider
			value={wrappedState as SuggestionMenuContextValue<unknown>}
		>
			{renderAsChild(rest, "div", primitiveProps)}
		</SuggestionMenuContext.Provider>
	);
}

export { SuggestionMenuContext };
