import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createProject } from "../src/create.ts";
import { isDefinedBackend } from "../src/backend.ts";

const packageRoot = resolve(import.meta.dir, "..");
const repositoryRoot = resolve(packageRoot, "../..");
const temporaryDirectories: string[] = [];
afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

async function generatedProject(): Promise<string> {
  const cwd = await mkdtemp(resolve(tmpdir(), "fia-template-backend-"));
  temporaryDirectories.push(cwd);
  const project = await createProject({
    name: "template-app",
    cwd,
    install: false,
    initializeGit: false,
    io: { stdout: () => {} },
    dependencies: { cliPackageSpec: `file:${packageRoot}` },
  });
  const modules = resolve(project, "node_modules");
  await mkdir(resolve(modules, "@base-ui"), { recursive: true });
  await mkdir(resolve(modules, "@semicoder"), { recursive: true });
  await mkdir(resolve(modules, "@types"), { recursive: true });
  await symlink(
    resolve(packageRoot, "node_modules/@base-ui/react"),
    resolve(modules, "@base-ui/react"),
    "dir",
  );
  await symlink(packageRoot, resolve(modules, "@semicoder/fia"), "dir");
  await symlink(
    resolve(repositoryRoot, "node_modules/typescript"),
    resolve(modules, "typescript"),
    "dir",
  );
  for (const dependency of [
    "bun-plugin-tailwind",
    "class-variance-authority",
    "clsx",
    "lucide-react",
    "react",
    "react-dom",
    "tailwind-merge",
    "tailwindcss",
  ] as const) {
    await symlink(
      resolve(packageRoot, "node_modules", dependency),
      resolve(modules, dependency),
      "dir",
    );
  }
  for (const dependency of ["bun", "react", "react-dom"] as const) {
    await symlink(
      dependency === "bun"
        ? resolve(repositoryRoot, "node_modules/@types/bun")
        : resolve(packageRoot, "node_modules/@types", dependency),
      resolve(modules, "@types", dependency),
      "dir",
    );
  }
  return project;
}

describe("generated resident backend React template", () => {
  test("typechecks against the published FIA API", async () => {
    const project = await generatedProject();
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "-p",
        resolve(project, "tsconfig.json"),
      ],
      { cwd: project, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0)
      throw new Error(`Generated template did not typecheck:\n${stdout}${stderr}`);
  });

  test("preserves route literals and exposes the shared runtime context", async () => {
    const project = await generatedProject();
    await Bun.write(
      resolve(project, "src/backend-contract.ts"),
      `
        import { defineBackend, type FIAServer } from "@semicoder/fia/backend";

        interface SocketData { connectedAt: number }
        declare const defaultServer: FIAServer;
        defaultServer.publish("events", "ready");

        export const backend = defineBackend<SocketData>()({
          http: {
            routes: {
              "/api/cards/:id": (request, server, { host, app }) => {
                const id: string = request.params.id;
                const directory: string = app.dataDirectory;
                const identifier: string = app.identifier;
                void host.clipboard.writeText(id);
                server.publish("events", directory + identifier);
                // @ts-expect-error The route does not declare a missing parameter.
                request.params.missing;
                return Response.json({ id });
              },
            },
          },
          start({ host, app, server, url }) {
            void host.application.getState();
            server.publish("events", app.name);
            url("/");
          },
        });

        // @ts-expect-error defineBackend is now a zero-argument builder.
        defineBackend({ http: {} });
      `,
    );
    const child = Bun.spawn(
      [
        process.execPath,
        resolve(repositoryRoot, "node_modules/typescript/bin/tsc"),
        "--noEmit",
        "-p",
        resolve(project, "tsconfig.json"),
      ],
      { cwd: project, stdout: "pipe", stderr: "pipe" },
    );
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    if (exitCode !== 0) {
      throw new Error(`Backend contract did not typecheck:\n${stdout}${stderr}`);
    }
  });

  test("exports a marked backend definition", async () => {
    const project = await generatedProject();
    const module = (await import(
      `${pathToFileURL(resolve(project, "src/backend.ts")).href}?test=${crypto.randomUUID()}`
    )) as { default: unknown };
    expect(isDefinedBackend(module.default)).toBe(true);
  });
});
