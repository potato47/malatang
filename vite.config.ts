import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import fia from "@semicoder/fia/vite";
export default defineConfig({ root: "frontend", plugins: [react(), fia()], build: { outDir: "dist", emptyOutDir: true } });
