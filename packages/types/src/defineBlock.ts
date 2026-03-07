import type {
  BlockSchema,
  PropSchema,
  ContentType,
} from "./types/schema.js";
import { resolveSchema } from "./prop.js";

type DefineBlockConfig = Omit<
  Partial<BlockSchema<string, Record<string, PropSchema>, ContentType>>,
  "type" | "propSchema" | "validateProps"
> & {
  props?: Record<string, unknown>;
  propSchema?: Record<string, unknown>;
  aiDescription?: string;
};

function resolveProps(
  config: DefineBlockConfig,
): Record<string, PropSchema> {
  const raw = config.props ?? config.propSchema ?? {};
  const resolved: Record<string, PropSchema> = {};
  for (const [k, v] of Object.entries(raw)) {
    resolved[k] = resolveSchema(v);
  }
  return resolved;
}

function typeNameToTitle(type: string): string {
  const spaced = type.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced
    .split(/[\s\-_]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function generateAIDescription(
  type: string,
  props: Record<string, PropSchema>,
): string {
  const propEntries = Object.entries(props);
  if (propEntries.length === 0) return type;
  const propDescriptions = propEntries
    .map(([name, schema]) => {
      const desc = schema.description ? ` (${schema.description})` : "";
      return `${name}${desc}`;
    })
    .join(", ");
  return `${type}: ${propDescriptions}`;
}

function generateValidator(
  propSchemas: Record<string, PropSchema>,
): (raw: Record<string, unknown>) => Record<string, unknown> {
  return (raw: Record<string, unknown>) => {
    const result: Record<string, unknown> = {};

    for (const [key, schema] of Object.entries(propSchemas)) {
      let value: unknown = raw[key];

      if (value === undefined || value === null) {
        result[key] = schema.default;
        continue;
      }

      const schemaType = Array.isArray(schema.type)
        ? schema.type[0]
        : schema.type;

      if (schemaType === "number" && typeof value === "string") {
        const parsed = Number(value);
        if (!Number.isNaN(parsed)) value = parsed;
      }

      if (schemaType === "boolean" && typeof value === "string") {
        value = value === "true";
      }

      if (schema.type && typeof value !== schemaType && schemaType !== undefined) {
        result[key] = schema.default;
        continue;
      }

      if (typeof value === "number") {
        if (schema.minimum !== undefined && value < schema.minimum) {
          value = schema.minimum;
        }
        if (typeof value === "number" && schema.maximum !== undefined && value > schema.maximum) {
          value = schema.maximum;
        }
      }

      if (schema.enum && !(schema.enum as unknown[]).includes(value)) {
        result[key] = schema.default;
        continue;
      }

      result[key] = value;
    }

    return result;
  };
}

export function defineBlock<Type extends string>(
  type: Type,
  config: DefineBlockConfig,
): BlockSchema<Type, Record<string, PropSchema>, ContentType>;
export function defineBlock<Type extends string>(
  config: DefineBlockConfig & { type: Type },
): BlockSchema<Type, Record<string, PropSchema>, ContentType>;
export function defineBlock<Type extends string>(
  typeOrConfig: Type | (DefineBlockConfig & { type: Type }),
  maybeConfig?: DefineBlockConfig,
): BlockSchema<Type, Record<string, PropSchema>, ContentType> {
  const type = (
    typeof typeOrConfig === "string" ? typeOrConfig : typeOrConfig.type
  ) as Type;
  const config =
    typeof typeOrConfig === "string" ? maybeConfig! : typeOrConfig;
  const props = resolveProps(config);

  return {
    type,
    propSchema: props,
    content: (config.content ?? "inline") as ContentType,
    layout: config.layout,
    serialize: config.serialize ?? {},
    normalize: config.normalize,
    validateProps:
      Object.keys(props).length > 0 ? generateValidator(props) : undefined,
    fieldEditor: config.fieldEditor,
    keyBindings: config.keyBindings,
    display: config.display ?? { title: typeNameToTitle(type) },
    isContainer: config.isContainer,
    aiDescription: config.aiDescription ?? generateAIDescription(type, props),
  } as BlockSchema<Type, Record<string, PropSchema>, ContentType>;
}
