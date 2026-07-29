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
  mcp?: boolean;
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
  ["AGENTS.md.template", "AGENTS.md"],
  ["fia.config.ts.template", "fia.config.ts"],
  ["README.md.template", "README.md"],
  ["tsconfig.json", "tsconfig.json"],
  ["bunfig.toml", "bunfig.toml"],
  ["gitignore", ".gitignore"],
  ["src/ui/index.html", "src/ui/index.html"],
  ["src/ui/main.tsx.template", "src/ui/main.tsx"],
  ["src/ui/style.css", "src/ui/style.css"],
  ["src/ui/components/ui/cn.ts.template", "src/ui/components/ui/cn.ts"],
  ["src/ui/components/ui/forms.tsx.template", "src/ui/components/ui/forms.tsx"],
  ["src/ui/components/ui/index.ts.template", "src/ui/components/ui/index.ts"],
  ["src/ui/components/ui/navigation.tsx.template", "src/ui/components/ui/navigation.tsx"],
  ["src/ui/components/ui/overlays.tsx.template", "src/ui/components/ui/overlays.tsx"],
  ["src/ui/components/ui/primitives.tsx.template", "src/ui/components/ui/primitives.tsx"],
  ["src/ui/components/ui/theme.tsx.template", "src/ui/components/ui/theme.tsx"],
  ["src/ui/components/ui/toast.tsx.template", "src/ui/components/ui/toast.tsx"],
] as const;

const MCP_TEMPLATE_FILES = [
  ["src/mcp/server.ts.template", "src/mcp/server.ts"],
  ["src/shared/types.ts.template", "src/shared/types.ts"],
  ["src/ui/App.tsx.template", "src/ui/App.tsx"],
] as const;

const UI_ONLY_TEMPLATE_FILES = [["src/ui/App.ui-only.tsx.template", "src/ui/App.tsx"]] as const;

const TEMPLATE_ASSETS = [
  ["assets/icon.png", "assets/icon.png"],
  ["assets/icon.icns", "assets/icon.icns"],
] as const;

function titleFromName(name: string): string {
  return name
    .split("-")
    .map((part) => `${part[0]!.toUpperCase()}${part.slice(1)}`)
    .join(" ");
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
      "@base-ui/react": "^1.6.0",
      "bun-plugin-tailwind": "^0.1.2",
      "class-variance-authority": "^0.7.1",
      clsx: "^2.1.1",
      "lucide-react": "^0.468.0",
      react: "^19.2.7",
      "react-dom": "^19.2.7",
      "tailwind-merge": "^3.3.1",
      tailwindcss: "^4.1.18",
      zod: "^4.2.0",
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
  withMcp: boolean,
  replacements: Readonly<Record<string, string>>,
): Promise<void> {
  const projectFiles = withMcp ? MCP_TEMPLATE_FILES : UI_ONLY_TEMPLATE_FILES;
  for (const [sourceName, destinationName] of [...COMMON_TEMPLATE_FILES, ...projectFiles]) {
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
  const templateDirectory =
    dependencies.templateDirectory ?? resolve(import.meta.dir, "../templates/react");
  const cliPackageSpec = dependencies.cliPackageSpec ?? `^${CLI_VERSION}`;
  const appName = titleFromName(options.name);
  const withMcp = options.mcp ?? true;
  const identifier = `com.example.${options.name}`;

  options.io.stdout(`Creating ${appName} in ${projectRoot}\n`);
  try {
    await mkdir(temporaryRoot);
    await renderTemplate(templateDirectory, temporaryRoot, withMcp, {
      __FIA_APP_NAME_JSON__: JSON.stringify(appName),
      __FIA_APP_IDENTIFIER_JSON__: JSON.stringify(identifier),
      __FIA_DISPLAY_NAME__: appName,
      __FIA_PACKAGE_NAME__: options.name,
      __FIA_MCP_CONFIG__: withMcp
        ? `\n  mcp: {\n    app: {\n      entry: "src/mcp/server.ts",\n      watch: ["src/mcp", "src/shared"],\n    },\n  },`
        : "",
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
      if (exitCode !== 0)
        throw new CreateProjectError(`bun install failed with exit code ${exitCode}`);
    }
    if (options.initializeGit) {
      options.io.stdout("Initializing Git repository\n");
      let exitCode: number;
      try {
        exitCode = await runner(["git", "init"], temporaryRoot);
      } catch (error) {
        throw new CreateProjectError("git init could not start", { cause: error });
      }
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
    `\nCreated ${appName}${withMcp ? " with an application MCP server" : " as a UI-only app"}. Next steps:\n  cd ${options.name}\n${installStep}  bun run dev\n`,
  );
  return projectRoot;
}
