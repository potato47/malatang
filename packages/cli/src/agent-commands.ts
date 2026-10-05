/** Built-in names cannot be replaced by application commands. */
export const reservedAgentCommands = new Set([
  "help",
  "schema",
  "call",
  "events",
  "exec",
  "open",
  "status",
  "quit",
  "install",
  "uninstall",
  "installation-status",
  "skill",
  "version",
]);

export interface ApplicationCommand {
  description: string;
  entry: string;
}

export interface ApplicationCommands {
  commands: Record<string, ApplicationCommand>;
  assetsDirectory: string;
}
