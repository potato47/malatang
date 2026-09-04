import { describe, expect, test } from "bun:test";
import { parseReleaseArguments, validateReleaseMetadata } from "../../../tools/publish-npm.ts";

describe("npm release workflow", () => {
  test("parses root release options strictly", () => {
    expect(parseReleaseArguments([])).toEqual({ dryRun: false, help: false });
    expect(parseReleaseArguments(["--dry-run"])).toEqual({ dryRun: true, help: false });
    expect(parseReleaseArguments(["--help"])).toEqual({ dryRun: false, help: true });
    expect(() => parseReleaseArguments(["--dry-run", "--dry-run"])).toThrow(
      "may only be specified once",
    );
    expect(() => parseReleaseArguments(["--tag", "next"])).toThrow("unknown option");
    expect(() => parseReleaseArguments(["--help", "--dry-run"])).toThrow(
      "does not accept other options",
    );
  });

  test("validates npm and source Swift Package release metadata", async () => {
    await expect(validateReleaseMetadata()).resolves.toBeUndefined();
  });
});
