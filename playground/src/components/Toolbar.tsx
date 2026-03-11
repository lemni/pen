import "./Toolbar.css";
import type { Editor } from "@pen/core";
import { htmlExporter } from "@pen/export-html";
import { markdownExporter } from "@pen/export-markdown";
import { setInlineMark } from "@pen/shortcuts";
import { Pen, useToolbar } from "@pen/react";
import {
	useEffect,
	useRef,
	useState,
	type FormEvent,
	type KeyboardEvent as ReactKeyboardEvent,
	type MouseEvent,
	type RefObject,
} from "react";
import { PLAYGROUND_BLOCK_TYPE_ORDER } from "../constants/playground";
import {
	IconArrowUp,
	IconBold,
	IconChain,
	IconCode,
	IconItalic,
	IconRedo,
	IconStrikethrough,
	IconUnderline,
	IconUndo,
} from "./icons";
import {
	canOpenLinkEditor,
	getActiveLinkMark,
	removeLinkMark,
} from "../utils/linkMarks";

type ToolbarProps = {
	editor: Editor;
	linkToggleRef: RefObject<(() => void) | null>;
};

export function Toolbar({ editor, linkToggleRef }: ToolbarProps) {
	const blockTypeOptions = getBlockTypeOptions(editor);

	const handleUndo = () => {
		editor.undoManager.undo();
	};

	const handleRedo = () => {
		editor.undoManager.redo();
	};

	return (
		<header className="toolbar" data-pen-ignore-pointer-gesture="">
			<div className="toolbar-left">
				<h4 className="toolbar-title">Pen</h4>
			</div>

			<div className="toolbar-right">
				<Pen.Toolbar.Root editor={editor}>
					<Pen.Toolbar.Select
						format="blockType"
						options={blockTypeOptions}
					/>

					<Pen.Toolbar.Separator />

					<Pen.Toolbar.Group>
						<Pen.Toolbar.Toggle format="bold">
							<IconBold className="toolbar-icon" />
						</Pen.Toolbar.Toggle>
						<Pen.Toolbar.Toggle format="italic">
							<IconItalic className="toolbar-icon" />
						</Pen.Toolbar.Toggle>
						<Pen.Toolbar.Toggle format="underline">
							<IconUnderline className="toolbar-icon" />
						</Pen.Toolbar.Toggle>
						<Pen.Toolbar.Toggle format="strikethrough">
							<IconStrikethrough className="toolbar-icon" />
						</Pen.Toolbar.Toggle>
						<Pen.Toolbar.Toggle format="code">
							<IconCode className="toolbar-icon" />
						</Pen.Toolbar.Toggle>
						<LinkButton editor={editor} linkToggleRef={linkToggleRef} />
					</Pen.Toolbar.Group>
				</Pen.Toolbar.Root>

				<Pen.Toolbar.Separator />

				<button
					className="toolbar-button toolbar-icon-button"
					onMouseDown={preventEditorBlur}
					onClick={handleUndo}
					type="button"
					title="Undo"
					aria-label="Undo"
				>
					<IconUndo size={12} className="toolbar-button-icon" />
				</button>
				<button
					className="toolbar-button toolbar-icon-button"
					onMouseDown={preventEditorBlur}
					onClick={handleRedo}
					type="button"
					title="Redo"
					aria-label="Redo"
				>
					<IconRedo size={12} className="toolbar-button-icon" />
				</button>

				<Pen.Toolbar.Separator />

				<ExportMenu editor={editor} />
			</div>
		</header>
	);
}

// ── Link button with popover ────────────────────────────────

type LinkButtonProps = {
	editor: Editor;
	linkToggleRef: RefObject<(() => void) | null>;
};

function LinkButton({ editor, linkToggleRef }: LinkButtonProps) {
	const toolbarState = useToolbar(editor);
	const popoverRef = useRef<HTMLDivElement | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const [isPopoverOpen, setIsPopoverOpen] = useState(false);
	const [url, setUrl] = useState("");

	const activeLinkValue = toolbarState.activeMarks.link;
	const activeLink =
		activeLinkValue && typeof activeLinkValue === "object"
			? (activeLinkValue as { href: string; title?: string })
			: null;
	const showRemoveButton = activeLink !== null;

	const openPopover = () => {
		if (!canOpenLinkEditor(editor)) return;
		setUrl(getActiveLinkMark(editor)?.href ?? "");
		setIsPopoverOpen(true);
	};

	const closePopover = () => {
		setIsPopoverOpen(false);
		setUrl("");
	};

	const handleMouseDown = (event: MouseEvent<HTMLButtonElement>) => {
		event.preventDefault();
		openPopover();
	};

	const applyLink = () => {
		const trimmed = url.trim();
		if (!trimmed) return;
		setInlineMark(editor, "link", { href: trimmed });
		closePopover();
	};

	const removeLink = () => {
		removeLinkMark(editor);
		closePopover();
	};

	const handleInputKeyDown = (event: ReactKeyboardEvent) => {
		event.stopPropagation();

		if (event.key === "Enter") {
			event.preventDefault();
			applyLink();
		}
		if (event.key === "Escape") {
			event.preventDefault();
			closePopover();
		}
	};

	const stopEditorPropagation = (
		event:
			| ReactKeyboardEvent<HTMLInputElement>
			| FormEvent<HTMLInputElement>
			| MouseEvent<HTMLInputElement>,
	) => {
		event.stopPropagation();
	};

	useEffect(() => {
		linkToggleRef.current = openPopover;

		return () => {
			if (linkToggleRef.current === openPopover) {
				linkToggleRef.current = null;
			}
		};
	}, [linkToggleRef, openPopover]);

	useEffect(() => {
		if (!isPopoverOpen) return;

		requestAnimationFrame(() => {
			inputRef.current?.focus();
			inputRef.current?.select();
		});

		const handlePointerDown = (event: PointerEvent) => {
			if (!popoverRef.current?.contains(event.target as Node)) {
				closePopover();
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				closePopover();
			}
		};

		window.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [isPopoverOpen]);

	return (
		<div className="toolbar-link-wrapper" ref={popoverRef}>
			<button
				data-pen-toolbar-toggle=""
				data-active={showRemoveButton || undefined}
				onMouseDown={handleMouseDown}
				type="button"
				title="Link (⌘K)"
				aria-label="Toggle link"
			>
				<IconChain className="toolbar-icon" />
			</button>
			{isPopoverOpen && (
				<div className="toolbar-link-popover">
					<input
						ref={inputRef}
						className="toolbar-link-input"
						type="url"
						placeholder="Paste or type a URL..."
						value={url}
						onMouseDown={stopEditorPropagation}
						onChange={(e) => setUrl(e.target.value)}
						onBeforeInput={stopEditorPropagation}
						onKeyDown={handleInputKeyDown}
					/>
					{showRemoveButton && (
						<button
							className="toolbar-link-remove"
							type="button"
							onMouseDown={preventEditorBlur}
							onClick={removeLink}
						>
							Remove
						</button>
					)}
					<button
						className="toolbar-link-apply"
						type="button"
						onMouseDown={preventEditorBlur}
						onClick={applyLink}
					>
						Apply
					</button>
				</div>
			)}
		</div>
	);
}

// ── Export menu ──────────────────────────────────────────────

type ExportMenuProps = {
	editor: Editor;
};

function ExportMenu({ editor }: ExportMenuProps) {
	const exportMenuRef = useRef<HTMLDivElement | null>(null);
	const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);

	const exportMenuItems = [
		{
			id: "markdown",
			label: "Markdown",
			onSelect: () => {
				const markdown = markdownExporter.export(editor, {});
				navigator.clipboard.writeText(markdown as string);
			},
		},
		{
			id: "html",
			label: "HTML",
			onSelect: () => {
				const html = htmlExporter.export(editor, {});
				navigator.clipboard.writeText(html as string);
			},
		},
	].map((item) => (
		<button
			key={item.id}
			className="toolbar-menu-item"
			type="button"
			onMouseDown={preventEditorBlur}
			onClick={() => {
				item.onSelect();
				setIsExportMenuOpen(false);
			}}
		>
			{item.label}
		</button>
	));

	useEffect(() => {
		if (!isExportMenuOpen) {
			return;
		}

		const handlePointerDown = (event: PointerEvent) => {
			const exportMenuElement = exportMenuRef.current;

			if (!exportMenuElement?.contains(event.target as Node)) {
				setIsExportMenuOpen(false);
			}
		};

		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setIsExportMenuOpen(false);
			}
		};

		window.addEventListener("pointerdown", handlePointerDown);
		window.addEventListener("keydown", handleKeyDown);

		return () => {
			window.removeEventListener("pointerdown", handlePointerDown);
			window.removeEventListener("keydown", handleKeyDown);
		};
	}, [isExportMenuOpen]);

	return (
		<div className="toolbar-menu" ref={exportMenuRef}>
			<button
				className="toolbar-button toolbar-icon-button"
				type="button"
				title="Export"
				aria-label="Export"
				aria-haspopup="menu"
				aria-expanded={isExportMenuOpen}
				data-active={isExportMenuOpen || undefined}
				onMouseDown={preventEditorBlur}
				onClick={() => setIsExportMenuOpen((value) => !value)}
			>
				<IconArrowUp className="toolbar-button-icon" />
			</button>

			{isExportMenuOpen && <div className="toolbar-menu-popover">{exportMenuItems}</div>}
		</div>
	);
}

function getBlockTypeOptions(editor: Editor) {
	const displayByType = new Map(
		editor.schema
			.allBlockDisplays()
			.map((schema) => [schema.type, schema.display.title] as const),
	);

	return PLAYGROUND_BLOCK_TYPE_ORDER.map((type) => ({
		value: type,
		label: displayByType.get(type) ?? type,
	}));
}

function preventEditorBlur(event: MouseEvent<HTMLButtonElement>) {
	event.preventDefault();
}
