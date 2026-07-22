import { copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CLI_VERSION } from "./metadata.ts";

export interface CreateIO {
  stdout(value: string): void;
}

export type CreateProcessRunner = (command: readonly string[], cwd: string) => Promise<number>;

export interface CreateProjectDependencies {
  runner?: CreateProcessRunner;
  templateDirectory?: string;
  cliPackageSpec?: string;
}

export interface CreateProjectOptions {
  name: string;
  cwd: string;
  runtime?: "bun" | "swift";
  install: boolean;
  initializeGit: boolean;
  io: CreateIO;
  dependencies?: CreateProjectDependencies;
}

export class CreateProjectError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "CreateProjectError";
  }
}

const COMMON_TEMPLATE_FILES = [
  ["tsconfig.json", "tsconfig.json"],
  ["gitignore", ".gitignore"],
  ["src/ui/index.html", "src/ui/index.html"],
  ["src/ui/main.tsx.template", "src/ui/main.tsx"],
  ["src/ui/style.css", "src/ui/style.css"],
] as const;

const BUN_TEMPLATE_FILES = [
  ["AGENTS.md.template", "AGENTS.md"],
  ["fia.config.ts.template", "fia.config.ts"],
  ["README.md.template", "README.md"],
  ["src/server.ts.template", "src/server.ts"],
  ["src/ui/App.tsx.template", "src/ui/App.tsx"],
] as const;

const SWIFT_TEMPLATE_FILES = [
  ["AGENTS.swift.md.template", "AGENTS.md"],
  ["fia.config.swift.ts.template", "fia.config.ts"],
  ["README.swift.md.template", "README.md"],
  ["src/ui/App.swift.tsx.template", "src/ui/App.tsx"],
  ["Backend/Package.swift.template", "Backend/Package.swift"],
  ["Backend/Sources/AppBackend/main.swift.template", "Backend/Sources/AppBackend/main.swift"],
] as const;

const TEMPLATE_ASSETS = [
  ["assets/icon.png", "assets/icon.png"],
  ["assets/icon.icns", "assets/icon.icns"],
] as const;

function titleFromName(name: string): string {
  return name.split("-").map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`).join(" ");
}

function validateName(name: string): void {
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(name) || name.includes("--")) {
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

async function defaultRunner(command: readonly string[], cwd: string): Promise<number> {
  const child = Bun.spawn([...command], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return await child.exited;
}

function packageMetadata(name: string, cliPackageSpec: string): Record<string, unknown> {
  return {
    name,
    version: "0.1.0",
    private: true,
    type: "module",
    engines: { bun: ">=1.3.14" },
    scripts: {
      dev: "fia dev",
      build: "fia build",
      run: "fia run",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      react: "^19.2.7",
      "react-dom": "^19.2.7",
    },
    devDependencies: {
      "@semicoder/fia": cliPackageSpec,
      "@types/bun": "1.3.14",
      "@types/react": "^19.2.17",
      "@types/react-dom": "^19.2.3",
      typescript: "7.0.2",
    },
  };
}

async function renderTemplate(
  templateDirectory: string,
  destination: string,
  runtime: "bun" | "swift",
  replacements: Readonly<Record<string, string>>,
): Promise<void> {
  const runtimeFiles = runtime === "swift" ? SWIFT_TEMPLATE_FILES : BUN_TEMPLATE_FILES;
  for (const [sourceName, destinationName] of [...COMMON_TEMPLATE_FILES, ...runtimeFiles]) {
    const source = resolve(templateDirectory, sourceName);
    const target = resolve(destination, destinationName);
    let contents = await readFile(source, "utf8");
    for (const [token, value] of Object.entries(replacements)) {
      contents = contents.replaceAll(token, value);
    }
    await mkdir(resolve(target, ".."), { recursive: true });
    await writeFile(target, contents, "utf8");
  }
  for (const [sourceName, destinationName] of TEMPLATE_ASSETS) {
    const source = resolve(templateDirectory, sourceName);
    const target = resolve(destination, destinationName);
    await mkdir(resolve(target, ".."), { recursive: true });
    await copyFile(source, target);
  }
}

export async function createProject(options: CreateProjectOptions): Promise<string> {
  validateName(options.name);
  const projectRoot = resolve(options.cwd, options.name);
  if (await exists(projectRoot)) {
    throw new CreateProjectError(`target already exists: ${projectRoot}`);
  }

  const temporaryRoot = resolve(options.cwd, `.fia-create-${options.name}-${crypto.randomUUID()}`);
  const dependencies = options.dependencies ?? {};
  const runner = dependencies.runner ?? defaultRunner;
  const templateDirectory = dependencies.templateDirectory ?? resolve(import.meta.dir, "../templates/react");
  const cliPackageSpec = dependencies.cliPackageSpec ?? `^${CLI_VERSION}`;
  const appName = titleFromName(options.name);
  const runtime = options.runtime ?? "bun";
  const swiftBaseName = appName.replaceAll(" ", "");
  const swiftProduct = `${/^\d/.test(swiftBaseName) ? "App" : ""}${swiftBaseName}Backend`;
  const identifier = `com.example.${options.name}`;

  options.io.stdout(`Creating ${appName} in ${projectRoot}\n`);
  try {
    await mkdir(temporaryRoot);
    await renderTemplate(templateDirectory, temporaryRoot, runtime, {
      __FIA_APP_NAME_JSON__: JSON.stringify(appName),
      __FIA_APP_IDENTIFIER_JSON__: JSON.stringify(identifier),
      __FIA_DISPLAY_NAME__: appName,
      __FIA_PACKAGE_NAME__: options.name,
      __FIA_SWIFT_PRODUCT__: swiftProduct,
    });
    await writeFile(
      resolve(temporaryRoot, "package.json"),
      `${JSON.stringify(packageMetadata(options.name, cliPackageSpec), null, 2)}\n`,
      "utf8",
    );

    if (options.install) {
      options.io.stdout("Installing dependencies with Bun\n");
      let exitCode: number;
      try {
        exitCode = await runner([process.execPath, "install"], temporaryRoot);
      } catch (error) {
        throw new CreateProjectError("bun install could not start", { cause: error });
      }
      if (exitCode !== 0) throw new CreateProjectError(`bun install failed with exit code ${exitCode}`);
    }
    if (options.initializeGit) {
      options.io.stdout("Initializing Git repository\n");
      let exitCode: number;
      try {
        exitCode = await runner(["git", "init"], temporaryRoot);
      } catch (error) {
        throw new CreateProjectError("git init could not start", { cause: error });
      }
      if (exitCode !== 0) throw new CreateProjectError(`git init failed with exit code ${exitCode}`);
    }

    await rename(temporaryRoot, projectRoot);
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    if (error instanceof CreateProjectError) throw error;
    throw new CreateProjectError("project creation failed", { cause: error });
  }

  const installStep = options.install ? "" : "  bun install\n";
  options.io.stdout(
    `\nCreated ${appName} (${runtime}). Next steps:\n  cd ${options.name}\n${installStep}  bun run dev\n`,
  );
  return projectRoot;
}
