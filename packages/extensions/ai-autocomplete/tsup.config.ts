import { defineConfig } from "tsup";

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm", "cjs"],
	dts: true,
	outDir: "dist",
	clean: true,
	external: ["@pen/ai", "@pen/core", "@pen/types"],
	outExtension({ format }) {
		return { js: format === "esm" ? ".mjs" : ".cjs" };
	},
});
