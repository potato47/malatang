import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { createProject } from "../packages/cli/src/create.ts";
import { loadProjectConfig } from "../packages/cli/src/project-config.ts";
import {
  buildApplication,
  defaultRunner,
  releaseApplication,
} from "../packages/cli/src/application.ts";
import { generateIcon, parseIconArguments } from "../packages/cli/src/icon.ts";
import { smokeApplication } from "../packages/cli/src/smoke.ts";
import { generateUpdateKeys, verifyRelease } from "../packages/cli/src/updates.ts";
import { checkProject } from "../packages/cli/src/check.ts";
import { repositoryRoot } from "./shared.ts";
import { smokeDevelopment } from "./smoke-development.ts";

const temporary = await mkdtemp(resolve(tmpdir(), "fia-v3-smoke-"));
try {
  const { projectRoot } = await createProject(
    { name: "fia-smoke", install: false, git: false, yes: true, local: true },
    temporary,
  );
  // Reuse the repository's installed dependencies; test app packaging without a network install.
  for (const name of [
    "react",
    "react-dom",
    "vite",
    "@vitejs/plugin-react",
    "typescript",
    "@types/react",
    "@types/react-dom",
    "@types/bun",
  ]) {
    let source: string;
    try {
      source = dirname(
        Bun.resolveSync(name + "/package.json", resolve(repositoryRoot, "packages/cli")),
      );
    } catch {
      source = dirname(Bun.resolveSync(name + "/package.json", repositoryRoot));
    }
    const destination = resolve(projectRoot, "node_modules", name);
    await mkdir(dirname(destination), { recursive: true });
    await symlink(source, destination);
  }
  const fia = resolve(projectRoot, "node_modules/@semicoder/fia");
  await mkdir(dirname(fia), { recursive: true });
  await symlink(resolve(repositoryRoot, "packages/cli"), fia);
  let config = await loadProjectConfig(projectRoot);
  const checks = await checkProject(projectRoot);
  if (!checks.ok) throw new Error(JSON.stringify(checks));
  const commands: string[][] = [];
  const built = await buildApplication(config, {
    runner: async (command, settings) => {
      if (command.some((part) => /(?:^|\/)swift(?:c)?$/u.test(part)))
        throw new Error("Application packaging invoked Swift");
      commands.push([...command]);
      return defaultRunner(command, settings);
    },
  });
  await generateIcon({ ...parseIconArguments(["中"]), cwd: projectRoot });
  console.log("Generated, typechecked, packaged and rendered an icon without Swift compilation.");
  const result = await smokeApplication(config, built.app);
  console.log(JSON.stringify(result, null, 2));
  const keys = await generateUpdateKeys(resolve(temporary, "keys"));
  const source = await readFile(resolve(projectRoot, "fia.config.ts"), "utf8");
  await writeFile(
    resolve(projectRoot, "fia.config.ts"),
    source.replace("build: 1", "build: 2").replace(
      "\n});",
      "\n  updates: " +
        JSON.stringify({
          url: "https://example.com/updates/latest.json",
          publicKey: keys.publicKey,
        }) +
        ",\n});",
    ),
  );
  config = await loadProjectConfig(projectRoot);
  process.env.FIA_UPDATE_PRIVATE_KEY_FILE = keys.privateKeyFile;
  const release = (await releaseApplication(config, true)) as { manifest: string };
  const envelope = JSON.parse(await readFile(release.manifest, "utf8"));
  const verified = verifyRelease(envelope, keys.publicKey);
  if (verified.build !== 2 || !verified.files.some((file) => file.path === "backend/index.js"))
    throw new Error("Code update release did not verify");
  console.log("Signed frontend/backend update package verified.");
  await smokeDevelopment(config);
  console.log(JSON.stringify({ ok: true, buildCommands: commands.map((command) => command[0]) }));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
