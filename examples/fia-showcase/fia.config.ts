import { defineConfig } from "@semicoder/fia/config";

export default defineConfig({
  configVersion: 5,
  app: {
    name: "FIA Toolbox",
    identifier: "com.semicoder.fia-showcase",
    version: "0.1.0",
  },
  backend: {
    entry: "src/backend.ts",
    watch: ["src"],
  },
  statusBar: {
    symbol: "square.grid.2x2.fill",
    tooltip: "FIA 工具箱",
  },
  // release: {
  //   identity: "Developer ID Application: Your Company (TEAMID)",
  //   notarization: { keychainProfile: "fia-notary" },
  // },
});
