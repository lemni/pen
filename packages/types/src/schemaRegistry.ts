import type {
	AppSchema,
	BlockDisplay,
	BlockSchema,
	ComposableSchema,
	InlineSchema,
	LayoutSchema,
	SchemaRegistry,
} from "./types/schema";
import { suggestion } from "./suggestion";

export interface SchemaRegistryConfig {
	blocks?: readonly BlockSchema[];
	inlines?: readonly InlineSchema[];
	apps?: readonly AppSchema[];
	systemMarks?: readonly InlineSchema[];
	onUnknownBlock?: (
		type: string,
		raw: unknown,
	) => BlockSchema | "drop" | "passthrough";
	onUnknownInline?: (
		type: string,
		raw: unknown,
	) => InlineSchema | "drop" | "passthrough";
}

function passthroughBlockSchema(type: string): BlockSchema {
	return {
		type,
		propSchema: {},
		content: "none" as const,
		serialize: {},
		display: { title: type },
	} as unknown as BlockSchema;
}

export class SchemaRegistryImpl implements ComposableSchema {
	private readonly _blocks: ReadonlyMap<string, BlockSchema>;
	private readonly _inlines: ReadonlyMap<string, InlineSchema>;
	private readonly _apps: ReadonlyMap<string, AppSchema>;
	private readonly _systemMarks: ReadonlyMap<string, InlineSchema>;
	private readonly _onUnknownBlock?: (
		type: string,
		raw: unknown,
	) => BlockSchema | "drop" | "passthrough";
	private readonly _onUnknownInline?: (
		type: string,
		raw: unknown,
	) => InlineSchema | "drop" | "passthrough";

	constructor(config: SchemaRegistryConfig) {
		this._blocks = new Map(config.blocks?.map((schema) => [schema.type, schema]));
		this._inlines = new Map(
			config.inlines?.map((schema) => [schema.type, schema]),
		);
		this._apps = new Map(config.apps?.map((schema) => [schema.type, schema]));

		const systemMarks = new Map<string, InlineSchema>([
			[suggestion.type, suggestion],
		]);
		if (config.systemMarks) {
			for (const schema of config.systemMarks) {
				systemMarks.set(schema.type, schema);
			}
		}
		this._systemMarks = systemMarks;

		this._onUnknownBlock = config.onUnknownBlock;
		this._onUnknownInline = config.onUnknownInline;
	}

	resolve(type: string): BlockSchema | null {
		const schema = this._blocks.get(type);
		if (schema) {
			return schema;
		}

		if (this._onUnknownBlock) {
			const result = this._onUnknownBlock(type, undefined);
			if (result === "drop") {
				return null;
			}
			if (result === "passthrough") {
				return passthroughBlockSchema(type);
			}
			return result;
		}

		return null;
	}

	resolveInline(type: string): InlineSchema | null {
		const inline = this._inlines.get(type);
		if (inline) {
			return inline;
		}

		const system = this._systemMarks.get(type);
		if (system) {
			return system;
		}

		if (this._onUnknownInline) {
			const result = this._onUnknownInline(type, undefined);
			if (result === "drop") {
				return null;
			}
			if (result === "passthrough") {
				return null;
			}
			return result;
		}

		return null;
	}

	resolveApp(type: string): AppSchema | null {
		return this._apps.get(type) ?? null;
	}

	resolveLayout(type: string): LayoutSchema | null {
		const schema = this.resolve(type);
		return schema?.layout ?? null;
	}

	allBlocks(): readonly BlockSchema[] {
		return [...this._blocks.values()];
	}

	allInlines(): readonly InlineSchema[] {
		return [...this._inlines.values(), ...this._systemMarks.values()];
	}

	allApps(): readonly AppSchema[] {
		return [...this._apps.values()];
	}

	allBlockDisplays(): readonly (BlockSchema & { display: BlockDisplay })[] {
		const result: (BlockSchema & { display: BlockDisplay })[] = [];
		for (const schema of this._blocks.values()) {
			if (schema.display && !schema.display.hidden) {
				result.push(schema as BlockSchema & { display: BlockDisplay });
			}
		}
		return result;
	}

	extend(schemas: readonly (BlockSchema | InlineSchema)[]): ComposableSchema {
		const blocks = new Map(this._blocks);
		const inlines = new Map(this._inlines);
		const systemMarks = new Map(this._systemMarks);

		for (const schema of schemas) {
			if ("kind" in schema) {
				if (schema.system) {
					systemMarks.set(schema.type, { ...schema, system: true });
				} else {
					inlines.set(schema.type, schema as InlineSchema);
				}
			} else {
				blocks.set(schema.type, schema as BlockSchema);
			}
		}

		return new SchemaRegistryImpl({
			blocks: [...blocks.values()],
			inlines: [...inlines.values()],
			apps: [...this._apps.values()],
			systemMarks: [...systemMarks.values()],
			onUnknownBlock: this._onUnknownBlock,
			onUnknownInline: this._onUnknownInline,
		});
	}

	without(types: readonly string[]): ComposableSchema {
		const typeSet = new Set(types);
		const blocks = new Map(this._blocks);
		const inlines = new Map(this._inlines);

		for (const type of typeSet) {
			blocks.delete(type);
			inlines.delete(type);
		}

		return new SchemaRegistryImpl({
			blocks: [...blocks.values()],
			inlines: [...inlines.values()],
			apps: [...this._apps.values()],
			systemMarks: [...this._systemMarks.values()],
			onUnknownBlock: this._onUnknownBlock,
			onUnknownInline: this._onUnknownInline,
		});
	}

	override(type: string, patch: Partial<BlockSchema>): ComposableSchema {
		const existing = this._blocks.get(type);
		if (!existing) {
			throw new Error(`Cannot override unknown block type: ${type}`);
		}

		const merged: BlockSchema = { ...existing, ...patch, type: existing.type };
		if (patch.serialize) {
			merged.serialize = { ...existing.serialize, ...patch.serialize };
		}

		const blocks = new Map(this._blocks);
		blocks.set(type, merged);

		return new SchemaRegistryImpl({
			blocks: [...blocks.values()],
			inlines: [...this._inlines.values()],
			apps: [...this._apps.values()],
			systemMarks: [...this._systemMarks.values()],
			onUnknownBlock: this._onUnknownBlock,
			onUnknownInline: this._onUnknownInline,
		});
	}

	overrideSystemMark(type: string, schema: InlineSchema): ComposableSchema {
		const systemMarks = new Map(this._systemMarks);
		systemMarks.set(type, { ...schema, system: true });

		return new SchemaRegistryImpl({
			blocks: [...this._blocks.values()],
			inlines: [...this._inlines.values()],
			apps: [...this._apps.values()],
			systemMarks: [...systemMarks.values()],
			onUnknownBlock: this._onUnknownBlock,
			onUnknownInline: this._onUnknownInline,
		});
	}
}

export function mergeSchemas(...registries: SchemaRegistry[]): ComposableSchema {
	const blocks = new Map<string, BlockSchema>();
	const inlines = new Map<string, InlineSchema>();
	const apps = new Map<string, AppSchema>();
	const systemMarks = new Map<string, InlineSchema>();

	for (const registry of registries) {
		for (const schema of registry.allBlocks()) {
			blocks.set(schema.type, schema);
		}
		for (const schema of registry.allInlines()) {
			if (schema.system) {
				systemMarks.set(schema.type, schema);
			} else {
				inlines.set(schema.type, schema);
			}
		}
		for (const schema of registry.allApps()) {
			apps.set(schema.type, schema);
		}
	}

	return new SchemaRegistryImpl({
		blocks: [...blocks.values()],
		inlines: [...inlines.values()],
		apps: [...apps.values()],
		systemMarks: [...systemMarks.values()],
	});
}
