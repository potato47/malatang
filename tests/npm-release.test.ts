import { describe, expect, test } from "bun:test";
import pkg from "../packages/sdk/package.json";
import { validatePackage, validateTrigger } from "../scripts/npm/check";
import { assertVersionIncrease } from "../scripts/npm/version";

describe("SDK npm release", () => {
  test("release tags follow SDK version rather than application version", () => {
    expect(validatePackage(pkg)).toEqual({ version: pkg.version, tag: `sdk-v${pkg.version}`, filename: `semicoder-malatang-sdk-${pkg.version}.tgz` });
    const env = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "potato47/malatang", GITHUB_EVENT_NAME: "push", GITHUB_REF: `refs/tags/sdk-v${pkg.version}` };
    expect(() => validateTrigger(pkg.version, env)).not.toThrow();
    for (const ref of [`refs/tags/v${pkg.version}`, "refs/tags/sdk-v9.9.9", "refs/heads/main"]) {
      expect(() => validateTrigger(pkg.version, { ...env, GITHUB_REF: ref })).toThrow("Tag and SDK version differ");
    }
    expect(() => validateTrigger(pkg.version, { ...env, GITHUB_REPOSITORY: "someone/fork" })).toThrow("configured repository");
    expect(() => validateTrigger(pkg.version, { ...env, GITHUB_EVENT_NAME: "pull_request" })).toThrow("Unexpected SDK release trigger");
    expect(() => validateTrigger(pkg.version, { ...env, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main" })).not.toThrow();
  });

  test("refuses wrong scope, repository, private publication and local dependencies", () => {
    for (const invalid of [
      { ...pkg, name: "@wrong/sdk" }, { ...pkg, private: true },
      { ...pkg, version: "0.1.0-beta.1" }, { ...pkg, version: "01.1.0" },
      { ...pkg, repository: { ...pkg.repository, url: "git+https://github.com/someone/fork.git" } },
      { ...pkg, publishConfig: { ...pkg.publishConfig, access: "restricted" } },
      { ...pkg, publishConfig: { ...pkg.publishConfig, registry: "https://example.com" } },
    ]) expect(() => validatePackage(invalid)).toThrow();
    for (const kind of ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"]) {
      for (const version of ["workspace:*", "file:../foo", "link:../foo", "../foo", "/tmp/foo"]) {
        expect(() => validatePackage({ ...pkg, [kind]: { foo: version } })).toThrow("local workspace paths");
      }
    }
  });

  test("version increments reject duplicates, downgrades and invalid versions", () => {
    for (const next of ["0.1.1", "0.2.0", "1.0.0"]) expect(() => assertVersionIncrease("0.1.0", next)).not.toThrow();
    for (const next of [undefined, "0.1.0", "0.0.9", "0.1", "v0.2.0", "0.2.0-beta.1", "0.2.0+build.1", "01.0.0"]) {
      expect(() => assertVersionIncrease("0.1.0", next)).toThrow();
    }
    expect(() => assertVersionIncrease("1.9.0", "1.10.0")).not.toThrow();
  });
});
