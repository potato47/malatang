import { defineConfig } from "@semicoder/fia/config";
export default defineConfig({
  app: { name: "Malatang", identifier: "com.semicoder.malatang", version: "0.1.0", build: 1, icon: "assets/icon.icns" },
  agent: { command: "malatang", description: "Manage Malatang plugins and models, invoke plugin methods, and follow model runs.", instructions: "agent/instructions.md" },
  backend: { assets: ["plugins/translate/package.json", "plugins/translate/dist", "resources/plugins"] },
  statusItem: { symbol: "square.stack.3d.up", tooltip: "麻辣烫" },
});
