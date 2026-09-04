import tailwindcss from "@tailwindcss/vite";
import fia from "@semicoder/fia/vite";
import { defineConfig } from "vite";

export default defineConfig({
  root: "frontend",
  plugins: [fia(), tailwindcss()],
  build: { outDir: "dist", emptyOutDir: true },
});
