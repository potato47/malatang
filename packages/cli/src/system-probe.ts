import { access, constants } from "node:fs/promises";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
}

export interface DoctorProbe {
  readonly platform: string;
  readonly architecture: string;
  readonly bunVersion: string | undefined;
  readonly cwd: string;
  run(command: readonly string[], timeoutMilliseconds?: number): Promise<CommandResult>;
  canAccess(path: string, mode: number): Promise<boolean>;
}

export const ACCESS_MODE = {
  executable: constants.X_OK,
  readableAndWritable: constants.R_OK | constants.W_OK,
} as const;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class SystemDoctorProbe implements DoctorProbe {
  public readonly platform = process.platform;
  public readonly architecture = process.arch;
  public readonly bunVersion = typeof Bun === "undefined" ? undefined : Bun.version;
  public readonly cwd = process.cwd();

  public async run(
    command: readonly string[],
    timeoutMilliseconds = 5_000,
  ): Promise<CommandResult> {
    if (command.length === 0) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "",
        timedOut: false,
        error: "Cannot run an empty command",
      };
    }

    try {
      const child = Bun.spawn([...command], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMilliseconds);
      timer.unref();

      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]).finally(() => clearTimeout(timer));

      return { exitCode, stdout, stderr, timedOut };
    } catch (error) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: "",
        timedOut: false,
        error: errorMessage(error),
      };
    }
  }

  public async canAccess(path: string, mode: number): Promise<boolean> {
    try {
      await access(path, mode);
      return true;
    } catch {
      return false;
    }
  }
}
