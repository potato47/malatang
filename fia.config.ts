import { defineConfig } from "@semicoder/fia/config";
export default defineConfig({
  app: { name: "Malatang", identifier: "com.example.malatang", version: "0.1.0", build: 1, icon: "assets/icon.icns" },
  agent: { command: "malatang", description: "Read and increment a shared counter from the desktop or an agent.", instructions: "agent/instructions.md" },
  statusItem: { symbol: "number.circle", tooltip: "Malatang" },
});
