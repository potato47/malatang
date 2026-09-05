import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { generateNativeAPI } from "./generate.ts";
import { resolveLocalFramework, validateLocalFrameworkLink } from "./local-framework.ts";
import { CLI_PACKAGE_NAME, CLI_VERSION } from "./metadata.ts";
import type { ProjectTemplate } from "./project-config.ts";

export interface CreateIO {
  stdout(value: string): void;
}

export type CreateProcessRunner = (command: readonly string[], cwd: string) => Promise<number>;

export interface CreateProjectDependencies {
  runner?: CreateProcessRunner;
  templateDirectory?: string;
  assetDirectory?: string;
  cliPackageSpec?: string;
  swiftPackageURL?: string;
  cliPackageDirectory?: string;
}

export interface CreateProjectOptions {
  name: string;
  cwd: string;
  install: boolean;
  initializeGit: boolean;
  template?: ProjectTemplate;
  backend?: boolean;
  local?: boolean;
  io: CreateIO;
  dependencies?: CreateProjectDependencies;
}

export class CreateProjectError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "CreateProjectError";
  }
}

const COMMON_FILES = [
  ["common/AGENTS.md.template", "AGENTS.md"],
  ["common/README.md.template", "README.md"],
  ["common/gitignore", ".gitignore"],
  ["common/native-api/api.fia.json", "native-api/api.fia.json"],
  ["common/native/Package.swift.template", "native/Package.swift"],
  [
    "common/native/Tests/FIAAppTests/FIAAppTests.swift",
    "native/Tests/FIAAppTests/FIAAppTests.swift",
  ],
] as const;

const WEB_FILES = [
  ["web/vite.config.ts", "vite.config.ts"],
  ["web/tsconfig.json", "tsconfig.json"],
  ["web/frontend/index.html", "frontend/index.html"],
  ["web/frontend/main.tsx", "frontend/main.tsx"],
  ["web/frontend/App.tsx.template", "frontend/App.tsx"],
  ["web/frontend/style.css", "frontend/style.css"],
] as const;

const BACKEND_FILES = [["backend/index.ts.template", "backend/index.ts"]] as const;

function titleFromName(name: string): string {
  return name
    .split("-")
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function validateName(name: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(name) || name.includes("--")) {
    throw new CreateProjectError("project name must be a single lowercase kebab-case name");
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export async function validateProjectTarget(name: string, cwd: string): Promise<void> {
  validateName(name);
  const projectRoot = resolve(cwd, name);
  if (await exists(projectRoot))
    throw new CreateProjectError(`target already exists: ${projectRoot}`);
}

async function defaultRunner(command: readonly string[], cwd: string): Promise<number> {
  const child = Bun.spawn([...command], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

function packageMetadata(
  name: string,
  cliPackageSpec: string,
  template: ProjectTemplate,
  backend: boolean,
): Record<string, unknown> {
  const web = template !== "native";
  return {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    engines: { bun: ">=1.4.0" },
    scripts: {
      dev: "fia dev",
      run: "fia run",
      generate: "fia generate",
      check: "fia check",
      test: "fia test",
      describe: "fia describe --json",
      build: "fia build",
      release: "fia release",
      ...(web ? { "web:dev": "vite", "web:build": "vite build", typecheck: "tsc --noEmit" } : {}),
    },
    dependencies: web
      ? {
          "@tailwindcss/vite": "^4.1.18",
          react: "^19.2.7",
          "react-dom": "^19.2.7",
          tailwindcss: "^4.1.18",
        }
      : {},
    devDependencies: {
      "@semicoder/fia": cliPackageSpec,
      ...(web
        ? {
            "@types/react": "^19.2.17",
            "@types/react-dom": "^19.2.3",
            typescript: "7.0.2",
            vite: "^7.1.3",
          }
        : {}),
      ...(backend ? { "@types/bun": "1.4.0" } : {}),
    },
  };
}

function toml(
  appName: string,
  identifier: string,
  template: ProjectTemplate,
  backend: boolean,
): string {
  const web = template !== "native";
  return `schema = 2\n\n[app]\nname = ${JSON.stringify(appName)}\nidentifier = ${JSON.stringify(identifier)}\nversion = "0.1.0"\nbuild = 1\nicon = "assets/icon.icns"\nminimumMacOS = "14.0"\nactivationPolicy = "regular"\n\n[web]\nenabled = ${web}\nroot = "frontend"\ndist = "frontend/dist"\n\n[backend]\nenabled = ${backend}\nruntime = "bun"\n${backend ? 'entry = "backend/index.ts"\nwatch = ["backend"]\n' : ""}mount = "/api"\n\n[native.permissions]\napplication = true\nwindows = true\n`;
}

async function renderFile(
  source: string,
  target: string,
  replacements: Readonly<Record<string, string>>,
): Promise<void> {
  let contents = await readFile(source, "utf8");
  for (const [token, value] of Object.entries(replacements))
    contents = contents.replaceAll(token, value);
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, contents, "utf8");
}

export async function createProject(options: CreateProjectOptions): Promise<string> {
  await validateProjectTarget(options.name, options.cwd);
  const projectRoot = resolve(options.cwd, options.name);
  const temporaryRoot = resolve(options.cwd, `.fia-create-${options.name}-${crypto.randomUUID()}`);
  const dependencies = options.dependencies ?? {};
  const runner = dependencies.runner ?? defaultRunner;
  const templateDirectory =
    dependencies.templateDirectory ?? resolve(import.meta.dir, "../templates/v2");
  const assetDirectory =
    dependencies.assetDirectory ?? resolve(import.meta.dir, "../templates/v2/common/assets");
  const localFramework = options.local
    ? await resolveLocalFramework(dependencies.cliPackageDirectory)
    : undefined;
  const cliPackageSpec = localFramework
    ? `link:${CLI_PACKAGE_NAME}`
    : (dependencies.cliPackageSpec ?? CLI_VERSION);
  const swiftPackageURL = dependencies.swiftPackageURL ?? "https://github.com/semicoder/fia.git";
  const template = options.template ?? "web";
  const backend = options.backend ?? false;
  const appName = titleFromName(options.name);
  const identifier = `com.example.${options.name}`;
  const replacements = {
    __FIA_APP_NAME_JSON__: JSON.stringify(appName),
    __FIA_APP_IDENTIFIER_JSON__: JSON.stringify(identifier),
    __FIA_DISPLAY_NAME__: appName,
    __FIA_PACKAGE_NAME__: options.name,
    __FIA_SWIFT_PACKAGE_DEPENDENCY__: localFramework
      ? `.package(name: "fia", path: ${JSON.stringify(localFramework.root)})`
      : `.package(url: ${JSON.stringify(swiftPackageURL)}, exact: "${CLI_VERSION}")`,
    __FIA_VERSION__: CLI_VERSION,
  };
  options.io.stdout(`Creating ${appName} in ${projectRoot}\n`);
  if (localFramework) options.io.stdout(`Using local FIA source: ${localFramework.root}\n`);
  try {
    await mkdir(temporaryRoot);
    const files = [
      ...COMMON_FILES,
      ...(template === "native" ? [] : WEB_FILES),
      ...(backend ? BACKEND_FILES : []),
      [
        template === "native"
          ? "native/App.native.swift.template"
          : template === "hybrid"
            ? "native/App.hybrid.swift.template"
            : "native/App.web.swift.template",
        "native/Sources/FIAApp/App.swift",
      ] as const,
      ...(template === "native" || template === "hybrid"
        ? [
            [
              "native/ContentView.swift.template",
              "native/Sources/FIAApp/ContentView.swift",
            ] as const,
          ]
        : []),
    ];
    for (const [source, target] of files) {
      await renderFile(
        resolve(templateDirectory, source),
        resolve(temporaryRoot, target),
        replacements,
      );
    }
    if (localFramework) {
      const readmePath = resolve(temporaryRoot, "README.md");
      await writeFile(
        readmePath,
        `${await readFile(readmePath, "utf8")}\n## Local FIA development\n\nThis project links to the FIA source checkout at ${JSON.stringify(localFramework.root)}.\nThe JavaScript package uses \`link:${CLI_PACKAGE_NAME}\`; run \`bun link\` in\n${JSON.stringify(localFramework.cliPackageDirectory)} before installing dependencies.\nSwiftPM uses the same checkout directly through an absolute path dependency.\n\nAfter changing FIA CLI, client, backend, or Vite sources, run \`bun run cli:build\`\nin that checkout, then restart \`bun run dev\` here. After changing FIA Swift sources,\nrestart \`bun run dev\` to rebuild. Application frontend changes use Vite HMR.\n\nThe global Bun link and Swift dependency path are specific to this machine.\n`,
      );
    }
    await mkdir(resolve(temporaryRoot, "assets"), { recursive: true });
    await Promise.all([
      copyFile(resolve(assetDirectory, "icon.icns"), resolve(temporaryRoot, "assets/icon.icns")),
      copyFile(resolve(assetDirectory, "icon.png"), resolve(temporaryRoot, "assets/icon.png")),
    ]);
    await writeFile(
      resolve(temporaryRoot, "fia.toml"),
      toml(appName, identifier, template, backend),
    );
    await writeFile(
      resolve(temporaryRoot, "package.json"),
      `${JSON.stringify(packageMetadata(options.name, cliPackageSpec, template, backend), null, 2)}\n`,
      "utf8",
    );
    await generateNativeAPI({ cwd: temporaryRoot });
    if (options.install) {
      options.io.stdout("Installing dependencies with Bun\n");
      const exitCode = await runner([process.execPath, "install"], temporaryRoot);
      if (exitCode !== 0)
        throw new CreateProjectError(
          `bun install failed with exit code ${exitCode}${localFramework ? `. Ensure bun link has been run in ${localFramework.cliPackageDirectory}` : ""}`,
        );
      if (localFramework) {
        try {
          await validateLocalFrameworkLink(temporaryRoot, localFramework);
        } catch (cause) {
          throw new CreateProjectError(
            cause instanceof Error ? cause.message : "local FIA link validation failed",
            { cause },
          );
        }
      }
    }
    if (options.initializeGit) {
      options.io.stdout("Initializing Git repository\n");
      const exitCode = await runner(["git", "init"], temporaryRoot);
      if (exitCode !== 0)
        throw new CreateProjectError(`git init failed with exit code ${exitCode}`);
    }
    await rename(temporaryRoot, projectRoot);
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    if (error instanceof CreateProjectError) throw error;
    throw new CreateProjectError("project creation failed", { cause: error });
  }
  const installStep = options.install ? "" : "  bun install\n";
  options.io.stdout(
    `\nCreated ${appName} (${template}${backend ? " + bun" : ""}). Next steps:\n  cd ${options.name}\n${installStep}  bun run dev\n`,
  );
  return projectRoot;
}
