import { defineConfig } from "@semicoder/fia/config";
import release from "./release/config.json";
import pkg from "./package.json";
const identity = process.env.MALATANG_SIGNING_IDENTITY;
export default defineConfig({
  app: { name: "Malatang", identifier: "com.semicoder.malatang", version: pkg.version, build: release.build, icon: "assets/icon.icns" },
  agent: { command: "malatang", description: "Manage Malatang plugins and models, invoke plugin methods, and follow model runs.", instructions: "agent/instructions.md" },
  backend: { assets: ["plugins/translate/package.json", "plugins/translate/dist", "resources/plugins"] },
  statusItem: { symbol: "square.stack.3d.up", tooltip: "麻辣烫" },
  ...(process.env.MALATANG_DISABLE_UPDATES === "1" ? {} : { updates: { url: release.updatesURL, publicKey: release.publicKey, downloadURL: release.downloadURL } }),
  ...(identity ? { signing: { releaseIdentity: identity, notarizationProfile: "malatang-notary" } } : {}),
});
