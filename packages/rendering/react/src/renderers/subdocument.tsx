import React, { useEffect, useState } from "react";
import type { BlockHandle, BlockRenderContext, Editor } from "@pen/types";
import { createEditor } from "@pen/core";
import { PenEditor } from "../penEditor";
import { useEditorContext } from "../context/editorContext";

function SubdocumentRendererInner(props: {
	block: BlockHandle;
	ctx: BlockRenderContext;
}) {
	const { block, ctx } = props;
	const {
		editor: parentEditor,
		readonly,
		importers,
		assets,
		renderers,
	} = useEditorContext();
	const [childEditor, setChildEditor] = useState<Editor | null>(null);

	const session = parentEditor.internals.documentSession;
	const childScope = session?.getScopeForBlock(block.id, {
		scopeId: parentEditor.documentScope.id,
	}) ?? null;
	const childScopeId = childScope?.id ?? null;

	useEffect(() => {
		if (!session || !childScopeId) {
			setChildEditor(null);
			return;
		}

		const nextChildEditor = createEditor({
			schema: parentEditor.schema,
			documentSession: session,
			documentScopeId: childScopeId,
		});
		setChildEditor(nextChildEditor);

		return () => {
			nextChildEditor.destroy();
		};
	}, [childScopeId, parentEditor.schema, session]);

	const activeChildEditor =
		childEditor && childEditor.documentScope.id === childScopeId
			? childEditor
			: null;

	return (
		<div
			ref={ctx.ref as React.Ref<HTMLDivElement>}
			data-block-type="subdocument"
			data-selected={ctx.selected || undefined}
			data-pen-subdocument-host=""
			data-subdocument-guid={childScope?.guid}
		>
			<div data-pen-ignore-pointer-gesture="">
				{activeChildEditor ? (
					<PenEditor
						editor={activeChildEditor}
						readonly={readonly}
						importers={importers}
						assets={assets}
						renderers={renderers}
					/>
				) : (
					<div data-pen-subdocument-placeholder="">
						{typeof block.props.title === "string"
							? block.props.title
							: "Subdocument"}
					</div>
				)}
			</div>
		</div>
	);
}

export function SubdocumentRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): React.ReactElement {
	return <SubdocumentRendererInner block={block} ctx={ctx} />;
}
