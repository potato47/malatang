import type { ModelConfig } from "./store";

// Explicit catalog renames from pi-ai 1.0.0 to 1.0.2. Never substitute a
// different provider/model for entries that simply disappeared from the catalog.
const aliases = new Map([
  ["cloudflare-ai-gateway", new Map([
    ["claude-fable-5.1", "claude-fable-5-1"],
    ["claude-haiku-4.5", "claude-haiku-4-5"],
    ["claude-opus-4.5", "claude-opus-4-5"],
    ["claude-opus-4.6", "claude-opus-4-6"],
    ["claude-opus-4.7", "claude-opus-4-7"],
    ["claude-opus-4.8", "claude-opus-4-8"],
    ["claude-opus-5.5", "claude-opus-5-5"],
    ["claude-sonnet-4.5", "claude-sonnet-4-5"],
    ["claude-sonnet-4.6", "claude-sonnet-4-6"],
  ])],
  ["together", new Map([["deepseek-ai/DeepSeek-V4-Pro", "deepseek-ai/DeepSeek-V4-Pro-0813"]])],
]);

export function migratePresetModel(config: ModelConfig) {
  if (!config.preset || config.chatgptProfileId) return;
  config.model = aliases.get(config.preset)?.get(config.model) ?? config.model;
}
