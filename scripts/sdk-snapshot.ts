import { cp, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { validatePackage } from "./npm/check";
const root = resolve(import.meta.dir, ".."),
  output = join(root, "resources/sdk");
const sourcePackage = await Bun.file(join(root, "packages/sdk/package.json")).json();
await mkdir(output, { recursive: true });
const archive = join(output, "malatang-sdk.tgz");
const packed = Bun.spawn(
  [process.execPath, "pm", "pack", "--filename", archive, "--ignore-scripts"],
  { cwd: join(root, "packages/sdk"), stdout: "ignore", stderr: "inherit" },
);
if ((await packed.exited) !== 0) throw new Error("SDK snapshot pack failed");
const temporary = await mkdtemp(join(tmpdir(), "malatang-snapshot-"));
try {
  const child = Bun.spawn(["tar", "-xzf", archive, "-C", temporary], {
    stdout: "ignore",
    stderr: "inherit",
  });
  if ((await child.exited) !== 0) throw new Error("Invalid SDK snapshot archive");
  const unpacked = join(temporary, "package"),
    pkg = await Bun.file(join(unpacked, "package.json")).json();
  validatePackage(pkg);
  if (pkg.version !== sourcePackage.version)
    throw new Error("SDK snapshot version must match the source package");
  for (const entry of Object.values(pkg.exports) as string[])
    if (!(await Bun.file(join(unpacked, entry)).exists()))
      throw new Error(`Missing SDK entry: ${entry}`);
  for (const entry of await readdir(unpacked))
    if (
      ![
        "package.json",
        "README.md",
        "src",
        "build.ts",
        "plugin.ts",
        "templates",
        "styles.ts",
        "create.ts",
        "dist",
      ].includes(entry)
    )
      throw new Error(`Unexpected SDK file: ${entry}`);
  for (const template of ["notes", "model"])
    if (!(await Bun.file(join(unpacked, "templates", template, "src/client.tsx")).exists()))
      throw new Error("Missing template");
  await rm(join(output, "templates"), { recursive: true, force: true });
  await cp(join(unpacked, "templates"), join(output, "templates"), { recursive: true });
  await Bun.write(
    join(output, "snapshot.json"),
    JSON.stringify(
      {
        version: pkg.version,
        sha256: new Bun.CryptoHasher("sha256")
          .update(await Bun.file(archive).arrayBuffer())
          .digest("hex"),
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
console.log(`Validated embedded SDK ${sourcePackage.version} archive and templates`);
