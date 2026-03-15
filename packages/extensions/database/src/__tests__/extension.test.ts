import { describe, expect, it, vi } from "vitest";
import { databaseExtension, DATABASE_CELL_KEYDOWN_SLOT } from "../extension";
import type { Editor } from "@pen/types";

type DatabaseExtensionTestEditor = {
	getBlock(blockId: string): {
		tableColumns(): Array<{ id: string; type: string }>;
		tableRow(index: number): { id: string } | null;
		tableCell(row: number, col: number): {
			textContent(): string;
		};
	} | null;
	apply: ReturnType<typeof vi.fn>;
	internals: {
		setSlot(key: string, value: unknown): void;
	};
};

function createKeyEvent(key: string): KeyboardEvent {
	return {
		key,
		metaKey: false,
		ctrlKey: false,
		altKey: false,
		preventDefault: vi.fn(),
		stopPropagation: vi.fn(),
	} as unknown as KeyboardEvent;
}

function createMockEditor() {
	const slots = new Map<string, unknown>();
	const apply = vi.fn();
	const block = {
		tableColumns: () => [{ id: "status", type: "select" }, { id: "done", type: "checkbox" }],
		tableRow: (index: number) => (index === 0 ? { id: "row-1" } : null),
		tableCell: (_row: number, col: number) => ({
			textContent: () => (col === 1 ? "false" : "todo"),
		}),
	};

	const editor = {
		getBlock: (blockId: string) => (blockId === "db-1" ? block : null),
		apply,
		internals: {
			setSlot: (key: string, value: unknown) => {
				slots.set(key, value);
			},
		},
	} satisfies DatabaseExtensionTestEditor;

	return { editor: editor as unknown as Editor, apply, slots };
}

describe("databaseExtension", () => {
	it("installs a built-in checkbox keydown delegate", async () => {
		const { editor, apply, slots } = createMockEditor();
		const extension = databaseExtension();

		await extension.activateClient?.({
			editor,
			dom: {} as Document,
			emit: () => undefined,
			getState: () => undefined,
		});

		const slot = slots.get(DATABASE_CELL_KEYDOWN_SLOT) as
			| ((event: KeyboardEvent, context: { blockId: string; row: number; col: number; root?: HTMLElement }) => boolean)
			| undefined;
		expect(slot).toBeTypeOf("function");

		const handled = slot?.(createKeyEvent(" "), {
			blockId: "db-1",
			row: 0,
			col: 1,
		});

		expect(handled).toBe(true);
		expect(apply).toHaveBeenCalledWith(
			[
				expect.objectContaining({
					type: "database-update-cell",
					blockId: "db-1",
					rowId: "row-1",
					columnId: "done",
					value: "true",
				}),
			],
			{ origin: "user" },
		);
	});

	it("opens widget triggers from cell selection", async () => {
		const { editor, slots } = createMockEditor();
		const extension = databaseExtension();

		await extension.activateClient?.({
			editor,
			dom: {} as Document,
			emit: () => undefined,
			getState: () => undefined,
		});

		const clickSpy = vi.fn();
		const trigger = {
			click: clickSpy,
			focus: vi.fn(),
		} as unknown as HTMLElement;
		const root = {
			querySelector: vi.fn(() => trigger),
		} as unknown as HTMLElement;

		const slot = slots.get(DATABASE_CELL_KEYDOWN_SLOT) as
			| ((event: KeyboardEvent, context: { blockId: string; row: number; col: number; root?: HTMLElement }) => boolean)
			| undefined;
		const handled = slot?.(createKeyEvent("Enter"), {
			blockId: "db-1",
			row: 0,
			col: 0,
			root,
		});

		expect(handled).toBe(true);
		expect(clickSpy).toHaveBeenCalledTimes(1);
	});
});
