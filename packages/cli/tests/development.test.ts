import { expect, test } from "bun:test";
import { hasProcessExited } from "../src/application.ts";

test("development detects both normal and signal-terminated child processes", async () => {
  const normal = Bun.spawn([process.execPath, "-e", "process.exit(0)"]);
  await normal.exited;
  expect(hasProcessExited(normal)).toBe(true);

  for (const signal of ["SIGINT", "SIGTERM", "SIGKILL"] as const) {
    const child = Bun.spawn(["/bin/sleep", "60"]);
    try {
      expect(hasProcessExited(child)).toBe(false);
      child.kill(signal);
      await child.exited;
      expect(child.signalCode).toBe(signal);
      expect(hasProcessExited(child)).toBe(true);
    } finally {
      if (!hasProcessExited(child)) child.kill("SIGKILL");
      await child.exited;
    }
  }
});
