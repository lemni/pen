import React, { createContext, useContext, useEffect, useRef } from "react";
import type { Editor } from "@pen/types";
import { EditorContext } from "../../context/editorContext";
import {
	useSlashMenu,
	type SlashMenuState,
	type SlashMenuActions,
} from "../../hooks/useSlashMenu";
import { renderAsChild, type AsChildProps } from "../../utils/asChild";
import { isDevelopmentEnvironment } from "../../utils/environment";

export type SlashMenuContextValue = SlashMenuState &
	SlashMenuActions & {
		editor?: Editor;
	};

const SlashMenuContext = createContext<SlashMenuContextValue | null>(null);

export function useSlashMenuContext(): SlashMenuContextValue {
	const ctx = useContext(SlashMenuContext);
	if (!ctx) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: useSlashMenuContext must be used within <Pen.SlashMenu.Root>.",
			);
		}
		throw new Error("Missing Pen.SlashMenu.Root context");
	}
	return ctx;
}

export interface SlashMenuRootProps extends AsChildProps {
	controller?: SlashMenuContextValue;
	editor?: Editor;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	ref?: React.Ref<HTMLElement>;
}

export function SlashMenuRoot(props: SlashMenuRootProps) {
	const { controller, editor, ...rest } = props;
	if (controller) {
		return (
			<SlashMenuRootContent
				{...rest}
				controller={controller}
				editor={editor}
			/>
		);
	}

	return <UncontrolledSlashMenuRoot {...rest} editor={editor} />;
}

type UncontrolledSlashMenuRootProps = Omit<SlashMenuRootProps, "controller">;

function UncontrolledSlashMenuRoot(props: UncontrolledSlashMenuRootProps) {
	const { editor: editorProp, ...rest } = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? editorContext?.editor;

	if (!editor) {
		if (isDevelopmentEnvironment()) {
			console.error(
				"Pen: <Pen.SlashMenu.Root> must be used within <Pen.Editor.Root> or receive an editor prop.",
			);
		}
		throw new Error("Missing editor for Pen.SlashMenu.Root");
	}

	const menuState = useSlashMenu(editor);

	return (
		<SlashMenuRootContent
			{...rest}
			controller={menuState}
			editor={editor}
		/>
	);
}

type SlashMenuRootContentProps = Omit<
	SlashMenuRootProps,
	"controller" | "editor"
> & {
	controller: SlashMenuContextValue;
	editor?: Editor;
};

function SlashMenuRootContent(props: SlashMenuRootContentProps) {
	const {
		controller,
		editor: editorProp,
		open: controlledOpen,
		onOpenChange,
		...rest
	} = props;
	const editorContext = useContext(EditorContext);
	const editor = editorProp ?? controller.editor ?? editorContext?.editor;

	const isOpen = controlledOpen ?? controller.open;

	const wrappedState: SlashMenuContextValue = {
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
		if (!isOpen) return;

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
		return () =>
			document.removeEventListener("keydown", handleKeyDown, true);
	}, [isOpen]);

	const primitiveProps: Record<string, unknown> = {
		role: "dialog",
		"data-pen-slash-menu": "",
		"data-open": isOpen || undefined,
	};

	return (
		<SlashMenuContext.Provider value={wrappedState}>
			{renderAsChild(rest, "div", primitiveProps)}
		</SlashMenuContext.Provider>
	);
}

export { SlashMenuContext };
