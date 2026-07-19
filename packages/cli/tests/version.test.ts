import { describe, expect, test } from "bun:test";
import {
  compareSemanticVersions,
  parseVersionArguments,
  readMetadataVersion,
  readWorkspaceVersionFromLock,
  replaceMetadataVersion,
  requireIncreasingVersion,
} from "../../../tools/version-npm.ts";

describe("npm version workflow", () => {
  test("parses one version or standalone help", () => {
    expect(parseVersionArguments(["0.3.0"])).toEqual({ help: false, version: "0.3.0" });
    expect(parseVersionArguments(["--help"])).toEqual({ help: true });
    expect(() => parseVersionArguments([])).toThrow("exactly one");
    expect(() => parseVersionArguments(["0.3.0", "0.4.0"])).toThrow("exactly one");
    expect(() => parseVersionArguments(["--force"])).toThrow("unknown option");
  });

  test("orders stable and prerelease semantic versions", () => {
    expect(compareSemanticVersions("0.3.0", "0.2.0")).toBeGreaterThan(0);
    expect(compareSemanticVersions("0.3.0-beta.2", "0.3.0-beta.1")).toBeGreaterThan(0);
    expect(compareSemanticVersions("0.3.0", "0.3.0-beta.2")).toBeGreaterThan(0);
    expect(compareSemanticVersions("0.3.0-beta.1", "0.3.0-beta.alpha")).toBeLessThan(0);
  });

  test("rejects invalid, equal, and decreasing versions", () => {
    expect(() => requireIncreasingVersion("0.2.0", "0.3.0")).not.toThrow();
    expect(() => requireIncreasingVersion("0.2.0", "0.2.0")).toThrow("must be greater");
    expect(() => requireIncreasingVersion("0.2.0", "0.1.9")).toThrow("must be greater");
    for (const value of ["v0.3.0", "0.03.0", "0.3", "0.3.0+build", "0.3.0-01"]) {
      expect(() => requireIncreasingVersion("0.2.0", value)).toThrow("invalid semantic version");
    }
  });

  test("rewrites only CLI metadata and reads the CLI lock workspace", () => {
    const metadata = 'export const CLI_VERSION = "0.2.0";\nexport const OTHER = "0.2.0";\n';
    const updated = replaceMetadataVersion(metadata, "0.2.0", "0.3.0");
    expect(readMetadataVersion(updated)).toBe("0.3.0");
    expect(updated).toContain('export const OTHER = "0.2.0";');
    expect(() => replaceMetadataVersion(metadata, "0.1.0", "0.3.0")).toThrow("does not match");
    expect(readWorkspaceVersionFromLock(`{
      "workspaces": {
        "packages/cli": {
          "name": "@semicoder/fia",
          "version": "0.3.0",
        },
      },
      "packages": {}
    }`)).toBe("0.3.0");
  });
});
