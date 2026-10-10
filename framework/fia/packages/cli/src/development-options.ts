import { safeRelative } from "./project-config.ts";

export function parseDevelopmentOptions(args: readonly string[]) {
  let openBrowser = false;
  const watchIgnore: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--open-browser") openBrowser = true;
    else if (arg === "--watch-ignore") {
      const path = args[++index];
      if (!path || !safeRelative(path) || path.startsWith("-"))
        throw new Error(
          "--watch-ignore requires a safe project-relative directory (no glob or parent traversal)",
        );
      watchIgnore.push(path);
    } else throw new Error("Unknown option for dev: " + arg);
  }
  return { openBrowser, watchIgnore };
}

export function isIgnoredDevelopmentPath(path: string, directories: readonly string[] = []) {
  return (
    /(?:^|\/)(?:node_modules|\.git|\.fia|\.build|dist)(?:\/|$)/u.test(path) ||
    directories.some((directory) => path === directory || path.startsWith(directory + "/"))
  );
}
