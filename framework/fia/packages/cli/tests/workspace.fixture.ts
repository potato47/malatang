import pkg from "../package.json";

export function standaloneLockFixture(packagePath = "packages/cli") {
  return (
    JSON.stringify(
      {
        lockfileVersion: 1,
        workspaces: {
          "": { name: "fia-framework", version: pkg.version },
          [packagePath]: { name: pkg.name, version: pkg.version },
        },
        packages: {},
      },
      null,
      2,
    ) + "\n"
  );
}
