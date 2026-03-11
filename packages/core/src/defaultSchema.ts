import { SchemaRegistryImpl } from "@pen/types";
import {
  defaultBlocks,
  defaultInlines,
} from "@pen/schema-default";

export function createBuiltInDefaultSchema(): SchemaRegistryImpl {
  return new SchemaRegistryImpl({
    blocks: defaultBlocks,
    inlines: defaultInlines,
  });
}

export const builtInDefaultSchema = createBuiltInDefaultSchema();
