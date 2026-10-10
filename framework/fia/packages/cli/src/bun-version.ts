export const MINIMUM_BUN_VERSION = "1.4.0";

export function isBunVersionSupported(version: string): boolean {
  return Bun.semver.satisfies(version, `>=${MINIMUM_BUN_VERSION}`);
}
