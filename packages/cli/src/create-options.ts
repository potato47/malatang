export interface CreateOptions {
  name?: string;
  install: boolean;
  git: boolean;
  yes: boolean;
  local: boolean;
}
export function parseCreateOptions(args: readonly string[]): CreateOptions {
  const result: CreateOptions = { install: true, git: false, yes: false, local: false };
  const seen = new Set<string>();
  for (const arg of args) {
    if (arg === "-y" || arg === "--yes") result.yes = true;
    else if (arg === "--local") result.local = true;
    else if (["--git", "--no-git", "--install", "--no-install"].includes(arg)) {
      const key = arg.includes("git") ? "git" : "install";
      if (seen.has(key)) throw new Error("Conflicting or duplicate option: " + arg);
      seen.add(key);
      result[key] = !arg.startsWith("--no-");
    } else if (arg.startsWith("-"))
      throw new Error(
        "Unknown create option: " + arg + ". FIA 4 has one shared API + desktop + agent template.",
      );
    else if (result.name) throw new Error("create accepts one project name");
    else result.name = arg;
  }
  return result;
}
