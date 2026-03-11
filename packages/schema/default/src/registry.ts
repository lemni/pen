import type {
  ComposableSchema,
  ContentType,
  InlineSchema,
  PropSchema,
  BlockSchema,
} from "@pen/types";
import { SchemaRegistryImpl } from "@pen/types";
import { defaultBlocks, defaultInlines } from "./defs";

export function createDefaultSchema(): ComposableSchema {
  return new SchemaRegistryImpl({
    blocks: defaultBlocks as BlockSchema[],
    inlines: defaultInlines as InlineSchema[],
  });
}
