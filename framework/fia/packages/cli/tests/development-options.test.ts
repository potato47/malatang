import { expect, test } from "bun:test";
import { isIgnoredDevelopmentPath, parseDevelopmentOptions } from "../src/development-options.ts";

test("dev exclusions apply at directory boundaries and allow repeated arguments", () => {
  const options = parseDevelopmentOptions([
    "--watch-ignore",
    "framework/fia",
    "--open-browser",
    "--watch-ignore",
    "vendor/tools",
  ]);
  expect(options.openBrowser).toBe(true);
  for (const path of [
    "framework/fia",
    "framework/fia/Sources/A.swift",
    "vendor/tools/a.ts",
    "other/.build/a.json",
    "node_modules/foo/a.ts",
  ])
    expect(isIgnoredDevelopmentPath(path, options.watchIgnore)).toBe(true);
  for (const path of ["framework/fia-extra/a.ts", "frontend/App.tsx", "backend/index.ts"])
    expect(isIgnoredDevelopmentPath(path, options.watchIgnore)).toBe(false);
  for (const args of [
    ["--watch-ignore"],
    ["--watch-ignore", ".."],
    ["--watch-ignore", "/tmp"],
    ["--watch-ignore", "../fia"],
    ["--watch-ignore", "--open-browser"],
    ["--unknown"],
  ])
    expect(() => parseDevelopmentOptions(args)).toThrow();
});
