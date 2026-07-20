export const MINIMUM_BUN_VERSION = "1.3.14";

export function isBunVersionSupported(version: string): boolean {
  return Bun.semver.satisfies(version, `>=${MINIMUM_BUN_VERSION}`);
}
