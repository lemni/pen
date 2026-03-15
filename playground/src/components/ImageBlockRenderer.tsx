import type { BlockHandle, BlockRenderContext } from "@pen/types";
import {
	DATA_ATTRS,
	ImageRenderer,
	useEditorContext,
} from "@pen/react";
import {
	type DragEvent,
	type ChangeEvent,
	type MouseEvent as ReactMouseEvent,
	type ReactElement,
	useRef,
	useState,
} from "react";
import "./ImageBlockRenderer.css";

const IMAGE_INPUT_ACCEPT = "image/*";
const IMAGE_MIME_PREFIX = "image/";
const UPLOAD_IMAGE_LABEL = "Upload image…";
const UPLOAD_IMAGE_HELP = "Click to browse or drag and drop";
const UPLOAD_IN_PROGRESS_LABEL = "Uploading image…";
const UPLOAD_UNAVAILABLE_LABEL = "Image uploads unavailable";
const UPLOAD_ERROR_MESSAGE = "Couldn't upload image.";

function getFirstImageFile(fileList: FileList | null): File | null {
	if (!fileList) {
		return null;
	}

	for (let index = 0; index < fileList.length; index += 1) {
		const file = fileList.item(index);
		if (file?.type.startsWith(IMAGE_MIME_PREFIX)) {
			return file;
		}
	}

	return null;
}

function getDefaultAltText(file: File): string {
	return file.name.replace(/\.[^.]+$/, "");
}

function hasFileTransfer(dataTransfer: DataTransfer): boolean {
	for (let index = 0; index < dataTransfer.types.length; index += 1) {
		if (dataTransfer.types[index] === "Files") {
			return true;
		}
	}

	return dataTransfer.files.length > 0;
}

function EmptyImageBlock(props: {
	block: BlockHandle;
	ctx: BlockRenderContext;
}): ReactElement {
	const { block, ctx } = props;
	const { editor, assets } = useEditorContext();

	const fileInputRef = useRef<HTMLInputElement | null>(null);
	const dragDepthRef = useRef(0);

	const [isDragging, setIsDragging] = useState(false);
	const [isUploading, setIsUploading] = useState(false);
	const [uploadError, setUploadError] = useState<string | null>(null);

	const isUploadAvailable = assets != null;
	const cardDescription = isUploadAvailable
		? UPLOAD_IMAGE_HELP
		: UPLOAD_UNAVAILABLE_LABEL;

	async function uploadFile(file: File) {
		if (!assets || isUploading || !file.type.startsWith(IMAGE_MIME_PREFIX)) {
			return;
		}

		setIsUploading(true);
		setUploadError(null);
		setIsDragging(false);
		dragDepthRef.current = 0;

		try {
			const ref = await assets.upload(file, {
				mimeType: file.type,
			});
			editor.apply(
				[
					{
						type: "update-block",
						blockId: block.id,
						props: {
							src: assets.resolve(ref),
							alt: (block.props?.alt as string | undefined) ?? getDefaultAltText(file),
						},
					},
				],
				{ origin: "user", undoGroup: true },
			);
			editor.selectBlock(block.id);
		} catch {
			setUploadError(UPLOAD_ERROR_MESSAGE);
		} finally {
			setIsUploading(false);
			if (fileInputRef.current) {
				fileInputRef.current.value = "";
			}
		}
	}

	function openFilePicker() {
		if (!isUploadAvailable || isUploading) {
			return;
		}

		fileInputRef.current?.click();
	}

	function handleFileInputChange(event: ChangeEvent<HTMLInputElement>) {
		const file = getFirstImageFile(event.currentTarget.files);
		if (!file) {
			return;
		}

		void uploadFile(file);
	}

	function handleInputClick(event: ReactMouseEvent<HTMLInputElement>) {
		event.currentTarget.value = "";
	}

	function handleDragEnter(event: DragEvent<HTMLButtonElement>) {
		if (
			!isUploadAvailable ||
			isUploading ||
			!hasFileTransfer(event.dataTransfer)
		) {
			return;
		}

		event.preventDefault();
		dragDepthRef.current += 1;
		setIsDragging(true);
	}

	function handleDragLeave(event: DragEvent<HTMLButtonElement>) {
		if (!isUploadAvailable || isUploading) {
			return;
		}

		event.preventDefault();
		dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
		if (dragDepthRef.current === 0) {
			setIsDragging(false);
		}
	}

	function handleDragOver(event: DragEvent<HTMLButtonElement>) {
		if (
			!isUploadAvailable ||
			isUploading ||
			!hasFileTransfer(event.dataTransfer)
		) {
			return;
		}

		event.preventDefault();
		event.dataTransfer.dropEffect = "copy";
		setIsDragging(true);
	}

	function handleDrop(event: DragEvent<HTMLButtonElement>) {
		if (!isUploadAvailable || isUploading) {
			return;
		}

		event.preventDefault();
		event.stopPropagation();
		setIsDragging(false);
		dragDepthRef.current = 0;

		const file = getFirstImageFile(event.dataTransfer.files);
		if (!file) {
			return;
		}

		void uploadFile(file);
	}

	return (
		<figure
			ref={ctx.ref as React.Ref<HTMLElement>}
			className="playground-image-block"
			data-block-type="image"
			data-selected={ctx.selected || undefined}
		>
			<button
				type="button"
				className="playground-image-upload-card"
				{...{ [DATA_ATTRS.ignoreTransfer]: "" }}
				data-dragging={isDragging || undefined}
				aria-busy={isUploading || undefined}
				disabled={!isUploadAvailable}
				onClick={openFilePicker}
				onDragEnter={handleDragEnter}
				onDragLeave={handleDragLeave}
				onDragOver={handleDragOver}
				onDrop={handleDrop}
			>
				<span className="playground-image-upload-card-label">
					{isUploading ? UPLOAD_IN_PROGRESS_LABEL : UPLOAD_IMAGE_LABEL}
				</span>
				<span className="playground-image-upload-card-help">
					{cardDescription}
				</span>
				<input
					ref={fileInputRef}
					className="playground-image-upload-input"
					type="file"
					accept={IMAGE_INPUT_ACCEPT}
					tabIndex={-1}
					onClick={handleInputClick}
					onChange={handleFileInputChange}
				/>
			</button>
			{uploadError ? (
				<figcaption className="playground-image-upload-error">
					{uploadError}
				</figcaption>
			) : null}
		</figure>
	);
}

export function PlaygroundImageRenderer(
	block: BlockHandle,
	ctx: BlockRenderContext,
): ReactElement {
	const src = (block.props?.src as string | undefined)?.trim() ?? "";
	if (src.length > 0) {
		return ImageRenderer(block, ctx) as React.ReactElement;
	}

	return <EmptyImageBlock block={block} ctx={ctx} />;
}
