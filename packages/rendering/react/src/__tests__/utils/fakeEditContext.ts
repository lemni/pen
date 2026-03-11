export class FakeEditContext {
	text: string;
	selectionStart: number;
	selectionEnd: number;
	private listeners = new Map<string, Set<(event: any) => void>>();

	constructor(options?: {
		text?: string;
		selectionStart?: number;
		selectionEnd?: number;
	}) {
		this.text = options?.text ?? "";
		this.selectionStart = options?.selectionStart ?? 0;
		this.selectionEnd = options?.selectionEnd ?? 0;
	}

	updateText(start: number, end: number, text: string): void {
		this.text = this.text.slice(0, start) + text + this.text.slice(end);
	}

	updateSelection(start: number, end: number): void {
		this.selectionStart = start;
		this.selectionEnd = end;
	}

	updateCharacterBounds(_start: number, _rects: DOMRect[]): void {
		// no-op for tests
	}

	addEventListener(type: string, handler: (event: any) => void): void {
		let handlers = this.listeners.get(type);
		if (!handlers) {
			handlers = new Set();
			this.listeners.set(type, handlers);
		}
		handlers.add(handler);
	}

	removeEventListener(type: string, handler: (event: any) => void): void {
		this.listeners.get(type)?.delete(handler);
	}

	emit(type: string, event: any): void {
		for (const handler of this.listeners.get(type) ?? []) {
			handler(event);
		}
	}
}
