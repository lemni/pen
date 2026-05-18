// @vitest-environment jsdom

import { FIELD_EDITOR_SLOT_KEY } from "@pen/types";
import { createTestEditor } from "@pen/test";
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { h, nextTick } from "vue";
import { PenEditor } from "../components/PenEditor";

afterEach(() => {
  document.body.innerHTML = "";
});

function createTableEditor() {
  const editor = createTestEditor({
    blocks: [
      {
        id: "table-1",
        type: "table",
        props: {},
      },
    ],
  });

  editor.apply([
    {
      type: "insert-table-cell-text",
      blockId: "table-1",
      row: 0,
      col: 0,
      offset: 0,
      text: "A1",
    },
  ]);

  return editor;
}

function createParagraphEditor() {
  return createTestEditor({
    blocks: [
      {
        id: "paragraph-1",
        type: "paragraph",
        props: {},
        content: "First",
      },
      {
        id: "paragraph-2",
        type: "paragraph",
        props: {},
        content: "Second",
      },
    ],
  });
}

function createClipboardData(): DataTransfer {
  const data = new Map<string, string>();

  return {
    files: [] as unknown as FileList,
    types: [],
    getData(type: string) {
      return data.get(type) ?? "";
    },
    setData(type: string, value: string) {
      data.set(type, value);
    },
  } as unknown as DataTransfer;
}

function setDomTextSelection(
  element: HTMLElement,
  startOffset: number,
  endOffset = startOffset,
) {
  const ownerDocument = element.ownerDocument;
  const selection = ownerDocument.getSelection();
  const textNode = element.firstChild;
  if (!selection || textNode?.nodeType !== Node.TEXT_NODE) {
    return;
  }

  const range = ownerDocument.createRange();
  range.setStart(textNode, startOffset);
  range.setEnd(textNode, endOffset);
  selection.removeAllRanges();
  selection.addRange(range);
}

function dispatchBeforeInput(
  element: HTMLElement,
  options: {
    inputType: string;
    data?: string;
    dataTransfer?: DataTransfer;
  },
) {
  const event = new InputEvent("beforeinput", {
    bubbles: true,
    cancelable: true,
    data: options.data,
    inputType: options.inputType,
  });

  if (options.dataTransfer) {
    Object.defineProperty(event, "dataTransfer", {
      configurable: true,
      value: options.dataTransfer,
    });
  }

  element.dispatchEvent(event);
}

async function flushTransfer() {
  await Promise.resolve();
  await nextTick();
  await Promise.resolve();
  await nextTick();
}

describe("@pen/vue", () => {
  it("mounts and renders a basic paragraph document", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Hello Vue",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    expect(wrapper.text()).toContain("Hello Vue");
    expect(editor.internals.getSlot(FIELD_EDITOR_SLOT_KEY)).toBeTruthy();

    wrapper.unmount();
    editor.destroy();
  });

  it("routes document delete shortcuts through the shared DOM handler", async () => {
    const editor = createParagraphEditor();
    const deleteSelection = vi.spyOn(editor, "deleteSelection").mockImplementation(() => undefined);

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });
    await nextTick();

    editor.selectBlock("paragraph-1");
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Backspace",
      }),
    );

    expect(deleteSelection).toHaveBeenCalledWith({ origin: "user" });

    deleteSelection.mockRestore();
    wrapper.unmount();
    editor.destroy();
  });

  it("activates the inline field editor on click", async () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Click me",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const inlineSurface = wrapper.get("[data-pen-inline-content]");
    await inlineSurface.trigger("mousedown");
    await inlineSurface.trigger("click");
    await nextTick();

    expect(
      wrapper.find("[data-pen-field-editor-active-surface]").exists(),
    ).toBe(true);

    wrapper.unmount();
    editor.destroy();
  });

  it("maps an inline click to the resolved caret offset", async () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Hello",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const inlineSurface = wrapper.get("[data-pen-inline-content]");
    const textNode = inlineSurface.element.firstChild;
    expect(textNode?.nodeType).toBe(Node.TEXT_NODE);

    const originalCaretRangeFromPoint = (
      document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      }
    ).caretRangeFromPoint;

    (
      document as Document & {
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
      }
    ).caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(textNode!, 2);
      range.collapse(true);
      return range;
    };

    await inlineSurface.trigger("mousedown", { clientX: 12, clientY: 8 });
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "text",
      anchor: { blockId: "paragraph-1", offset: 2 },
      focus: { blockId: "paragraph-1", offset: 2 },
    });

    if (originalCaretRangeFromPoint) {
      (
        document as Document & {
          caretRangeFromPoint?: (x: number, y: number) => Range | null;
        }
      ).caretRangeFromPoint = originalCaretRangeFromPoint;
    } else {
      Reflect.deleteProperty(
        document as Document & Record<string, unknown>,
        "caretRangeFromPoint",
      );
    }

    wrapper.unmount();
    editor.destroy();
  });

  it("renders a block with a custom renderer override", () => {
    const editor = createTestEditor({
      blocks: [
        {
          id: "paragraph-1",
          type: "paragraph",
          props: {},
          content: "Override me",
        },
      ],
    });

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: {
        editor,
        renderers: {
          paragraph: (block) =>
            h("div", { "data-custom-renderer": "" }, `Custom ${block.textContent()}`),
        },
      },
    });

    expect(wrapper.find("[data-custom-renderer]").exists()).toBe(true);
    expect(wrapper.text()).toContain("Custom Override me");

    wrapper.unmount();
    editor.destroy();
  });

  it("selects and activates a table cell for editing", async () => {
    const editor = createTableEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const tableCell = wrapper.get("[data-pen-table-cell]");
    await tableCell.trigger("mousedown");
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "cell",
      blockId: "table-1",
      anchor: { row: 0, col: 0 },
      head: { row: 0, col: 0 },
    });

    await tableCell.trigger("dblclick");
    await nextTick();

    expect(
      wrapper.find("[data-pen-field-editor-active-surface]").exists(),
    ).toBe(true);

    wrapper.unmount();
    editor.destroy();
  });

  it("moves table selection with ArrowRight and enters editing with Enter", async () => {
    const editor = createTableEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const firstCell = wrapper.get("[data-pen-table-cell]");
    await firstCell.trigger("mousedown");
    await nextTick();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowRight",
        bubbles: true,
      }),
    );
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "cell",
      blockId: "table-1",
      anchor: { row: 0, col: 1 },
      head: { row: 0, col: 1 },
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    await nextTick();

    expect(
      wrapper.find("[data-pen-field-editor-active-surface]").exists(),
    ).toBe(true);

    wrapper.unmount();
    editor.destroy();
  });

  it("activates inline editing from a block selection with Enter", async () => {
    const editor = createParagraphEditor();
    editor.selectBlock("paragraph-1");

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor, interactionModel: "block-first" },
    });
    await nextTick();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
      }),
    );
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "text",
      anchor: { blockId: "paragraph-1", offset: 5 },
      focus: { blockId: "paragraph-1", offset: 5 },
    });

    wrapper.unmount();
    editor.destroy();
  });

  it("moves from block selection to the next inline block with ArrowDown", async () => {
    const editor = createParagraphEditor();
    editor.selectBlock("paragraph-1");

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });
    await nextTick();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "ArrowDown",
        bubbles: true,
      }),
    );
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "text",
      anchor: { blockId: "paragraph-2", offset: 0 },
      focus: { blockId: "paragraph-2", offset: 0 },
    });

    wrapper.unmount();
    editor.destroy();
  });

  it("transitions from text editing to block selection on Escape", async () => {
    const editor = createParagraphEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });
    await nextTick();

    const firstInline = wrapper.findAll("[data-pen-inline-content]")[0]!;
    await firstInline.trigger("mousedown");
    await firstInline.trigger("click");
    await nextTick();

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Escape",
        bubbles: true,
      }),
    );
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "block",
      blockIds: ["paragraph-1"],
    });

    wrapper.unmount();
    editor.destroy();
  });

  it("selects the document text with Mod-A", async () => {
    const editor = createParagraphEditor();
    editor.selectText("paragraph-1", 0, 0);

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "a",
        metaKey: true,
        bubbles: true,
      }),
    );
    await nextTick();

    expect(editor.selection).toMatchObject({
      type: "text",
      anchor: { blockId: "paragraph-1", offset: 0 },
      focus: { blockId: "paragraph-2", offset: 6 },
    });

    wrapper.unmount();
    editor.destroy();
  });

  it("undoes text changes with Mod-Z", async () => {
    const editor = createParagraphEditor();
    editor.selectText("paragraph-1", 5, 5);
    editor.replaceSelection("!");

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "z",
        metaKey: true,
        bubbles: true,
      }),
    );
    await nextTick();

    expect(editor.getBlock("paragraph-1")?.textContent()).toBe("First");

    wrapper.unmount();
    editor.destroy();
  });

  it("applies inline typing through the active field editor", async () => {
    const editor = createParagraphEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const firstInline = wrapper.findAll("[data-pen-inline-content]")[0]!;
    await firstInline.trigger("mousedown");
    await firstInline.trigger("click");
    await nextTick();

    const activeSurface = wrapper.get("[data-pen-field-editor-active-surface]");
    setDomTextSelection(activeSurface.element as HTMLElement, 5);
    dispatchBeforeInput(activeSurface.element as HTMLElement, {
      inputType: "insertText",
      data: "!",
    });
    await nextTick();

    expect(editor.getBlock("paragraph-1")?.textContent()).toBe("First!");

    wrapper.unmount();
    editor.destroy();
  });

  it("pastes plain text through the active field editor", async () => {
    const editor = createParagraphEditor();

    const wrapper = mount(PenEditor, {
      attachTo: document.body,
      props: { editor },
    });

    const firstInline = wrapper.findAll("[data-pen-inline-content]")[0]!;
    await firstInline.trigger("mousedown");
    await firstInline.trigger("click");
    await nextTick();

    const clipboardData = createClipboardData();
    clipboardData.setData("text/plain", " world");

    const activeSurface = wrapper.get("[data-pen-field-editor-active-surface]");
    editor.selectText("paragraph-1", 5, 5);
    await nextTick();
    setDomTextSelection(activeSurface.element as HTMLElement, 5);
    dispatchBeforeInput(activeSurface.element as HTMLElement, {
      inputType: "insertFromPaste",
      dataTransfer: clipboardData,
    });
    await flushTransfer();

    expect(editor.getBlock("paragraph-1")?.textContent()).toBe("First world");

    wrapper.unmount();
    editor.destroy();
  });
});
