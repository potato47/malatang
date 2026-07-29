import { type CommandResult, type DoctorProbe } from "../src/system-probe.ts";

function commandKey(command: readonly string[]): string {
  return command.join("\u0000");
}

export function commandResult(stdout = "", overrides: Partial<CommandResult> = {}): CommandResult {
  return {
    exitCode: 0,
    stdout,
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}

export class FakeDoctorProbe implements DoctorProbe {
  public platform = "darwin";
  public architecture = "arm64";
  public bunVersion: string | undefined = "1.3.14";
  public cwd = "/tmp/fia-project";
  public readonly commands = new Map<string, CommandResult>();
  public readonly accessible = new Map<string, boolean>([
    ["/usr/bin/codesign", true],
    [this.cwd, true],
  ]);
  public readonly calls: string[][] = [];

  public constructor() {
    this.setCommand(["/usr/bin/sw_vers", "-productVersion"], commandResult("26.5.2\n"));
    this.setCommand(
      ["/usr/bin/xcrun", "swift", "--version"],
      commandResult("swift-driver version: 1.148.6 Apple Swift version 6.3.2\n"),
    );
    this.setCommand(
      ["/usr/bin/xcodebuild", "-version"],
      commandResult("Xcode 26.5\nBuild version 17F42\n"),
    );
    this.setCommand(
      ["/usr/bin/xcrun", "--find", "notarytool"],
      commandResult("/usr/bin/notarytool\n"),
    );
    this.setCommand(["/usr/bin/xcrun", "--find", "stapler"], commandResult("/usr/bin/stapler\n"));
    this.setCommand(
      ["/usr/bin/security", "find-identity", "-v", "-p", "codesigning"],
      commandResult(
        '  1) ABCDEF "Developer ID Application: Example (TEAMID)"\n     1 valid identities found\n',
      ),
    );
  }

  public setCommand(command: readonly string[], value: CommandResult): void {
    this.commands.set(commandKey(command), value);
  }

  public async run(command: readonly string[]): Promise<CommandResult> {
    this.calls.push([...command]);
    return (
      this.commands.get(commandKey(command)) ??
      commandResult("", {
        exitCode: 127,
        stderr: "command not found",
        error: "command not found",
      })
    );
  }

  public async canAccess(path: string, _mode: number): Promise<boolean> {
    return this.accessible.get(path) ?? false;
  }
}
