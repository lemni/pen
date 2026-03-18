import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: process.env.PEN_DOCS_BASE ?? "/",
  plugins: [react()],
  resolve: {
    dedupe: ["react", "react-dom"],
  },
});
