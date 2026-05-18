import type { Editor, InlineDecoration, OpOrigin } from "@pen/types";
import { fullReconcileToDOM } from "./reconciler";
import type { FieldEditorTextLike } from "./crdt";

interface SessionSnapshot {
	focusBlockId: string | null;
	activeBlockIds: readonly string[];
	isEditing: boolean;
	mode: "inactive" | "single" | "expanded" | "block";
}

interface SessionReconcilerOptions {
	getSnapshot: () => SessionSnapshot;
	getAttachedElement: () => HTMLElement | null;
	getInlineElement: (blockId: string) => HTMLElement | null;
	getYText: (blockId: string) => FieldEditorTextLike | null;
	shouldPreserveSelection: () => boolean;
	shouldProjectSelection: () => boolean;
	projectSelection: () => void;
	notifyDomReconciled?: (blockId: string) => void;
}

export class SessionReconciler {
	private readonly editor: Editor;
	private readonly options: SessionReconcilerOptions;
	private readonly pendingBlockIds = new Set<string>();
	private scheduledFrame: number | null = null;
	private shouldProjectSelection = false;
	private readonly unsubscribeCommit: () => void;
	private readonly unsubscribeDecorationsChange: () => void;

	constructor(editor: Editor, options: SessionReconcilerOptions) {
		this.editor = editor;
		this.options = options;
		this.unsubscribeCommit = this.editor.onDocumentCommit((event) => {
			this.handleCommit(event.origin, event.affectedBlocks);
		});
		this.unsubscribeDecorationsChange = this.editor.on(
			"decorationsChange",
			() => {
				this.handleDecorationsChange();
			},
		);
	}

	destroy(): void {
		this.unsubscribeCommit();
		this.unsubscribeDecorationsChange();
		if (this.scheduledFrame !== null) {
			cancelAnimationFrame(this.scheduledFrame);
			this.scheduledFrame = null;
		}
		this.pendingBlockIds.clear();
		this.shouldProjectSelection = false;
	}

	private handleCommit(
		origin: OpOrigin,
		affectedBlocks: readonly string[],
	): void {
		const snapshot = this.options.getSnapshot();
		if (!snapshot.isEditing) {
			return;
		}

		if (snapshot.mode === "expanded") {
			const activeBlockIdSet = new Set(snapshot.activeBlockIds);
			const targetBlockIds = affectedBlocks.filter((blockId) =>
				activeBlockIdSet.has(blockId),
			);
			if (targetBlockIds.length === 0) {
				return;
			}
			for (const blockId of targetBlockIds) {
				this.pendingBlockIds.add(blockId);
			}
			this.shouldProjectSelection = true;
			this.scheduleFlush();
			return;
		}

		if (snapshot.mode !== "single" || !snapshot.focusBlockId) {
			return;
		}

		const focusBlockId = snapshot.focusBlockId;
		const focusBlockChanged = affectedBlocks.includes(focusBlockId);
		const passiveBlockIds = affectedBlocks.filter(
			(blockId) => blockId !== focusBlockId,
		);
		const shouldReconcileFocusBlock =
			focusBlockChanged && origin === "history";

		if (!shouldReconcileFocusBlock && passiveBlockIds.length === 0) {
			return;
		}

		if (shouldReconcileFocusBlock) {
			this.pendingBlockIds.add(focusBlockId);
			this.shouldProjectSelection = true;
		}
		for (const blockId of passiveBlockIds) {
			this.pendingBlockIds.add(blockId);
		}
		this.scheduleFlush();
	}

	private handleDecorationsChange(): void {
		const snapshot = this.options.getSnapshot();
		if (!snapshot.isEditing) {
			return;
		}
		if (snapshot.mode === "expanded") {
			for (const blockId of snapshot.activeBlockIds) {
				this.pendingBlockIds.add(blockId);
			}
			if (snapshot.activeBlockIds.length > 0) {
				this.scheduleFlush();
			}
			return;
		}
		if (snapshot.mode === "single" && snapshot.focusBlockId) {
			this.pendingBlockIds.add(snapshot.focusBlockId);
			this.scheduleFlush();
		}
	}

	private scheduleFlush(): void {
		if (this.scheduledFrame !== null) {
			return;
		}
		this.scheduledFrame = requestAnimationFrame(() => {
			this.scheduledFrame = null;
			this.flush();
		});
	}

	private flush(): void {
		if (this.pendingBlockIds.size === 0) {
			this.shouldProjectSelection = false;
			return;
		}

		const snapshot = this.options.getSnapshot();
		const blockIds = [...this.pendingBlockIds];
		this.pendingBlockIds.clear();
		const shouldProjectSelection = this.shouldProjectSelection;
		this.shouldProjectSelection = false;

		if (!snapshot.isEditing) {
			return;
		}

		const preserveSelection = this.options.shouldPreserveSelection();

		if (snapshot.mode === "expanded") {
			const activeBlockIdSet = new Set(snapshot.activeBlockIds);
			for (const blockId of blockIds) {
				if (!activeBlockIdSet.has(blockId)) {
					continue;
				}
				this.reconcileBlock(blockId, preserveSelection);
			}
			if (
				shouldProjectSelection &&
				this.options.shouldProjectSelection()
			) {
				this.options.projectSelection();
			}
			return;
		}

		if (snapshot.mode !== "single" || !snapshot.focusBlockId) {
			return;
		}

		for (const blockId of blockIds) {
			if (blockId === snapshot.focusBlockId) {
				const element =
					this.options.getAttachedElement() ??
					this.options.getInlineElement(snapshot.focusBlockId);
				const ytext = this.options.getYText(snapshot.focusBlockId);
				if (!element || !ytext) {
					continue;
				}
				fullReconcileToDOM(ytext, element, this.editor.schema, {
					preserveSelection,
					inlineDecorations: this.getInlineDecorations(blockId),
				});
				this.options.notifyDomReconciled?.(blockId);
				continue;
			}
			this.reconcileBlock(blockId, preserveSelection);
		}
		if (shouldProjectSelection && this.options.shouldProjectSelection()) {
			this.options.projectSelection();
		}
	}

	private reconcileBlock(blockId: string, preserveSelection = true): void {
		const inlineElement = this.options.getInlineElement(blockId);
		const ytext = this.options.getYText(blockId);
		if (!inlineElement || !ytext) {
			return;
		}
		fullReconcileToDOM(ytext, inlineElement, this.editor.schema, {
			preserveSelection,
			inlineDecorations: this.getInlineDecorations(blockId),
		});
		this.options.notifyDomReconciled?.(blockId);
	}

	private getInlineDecorations(blockId: string): readonly InlineDecoration[] {
		return this.editor
			.getDecorations()
			.forBlock(blockId)
			.filter(
				(decoration): decoration is InlineDecoration =>
					decoration.type === "inline",
			);
	}
}
