import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { chmod, mkdir, open, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

export class ChatGPTStorage {
  private readonly path: string;
  constructor(private readonly directory: string) {
    this.path = join(directory, "chatgpt-auth.json");
  }
  private async prepare() {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
  }
  async readSecret(): Promise<string | null> {
    await this.prepare();
    let file;
    try {
      file = await open(this.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
    try {
      if (!(await file.stat()).isFile()) throw new Error("Invalid credential file");
      await file.chmod(0o600);
      return await file.readFile("utf8");
    } finally {
      await file.close();
    }
  }
  async writeSecret(value: string): Promise<void> {
    await this.prepare();
    const temporary = join(this.directory, `.chatgpt-auth.${randomUUID()}.tmp`);
    const file = await open(temporary, "wx", 0o600);
    try {
      try {
        await file.chmod(0o600);
        await file.writeFile(value, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temporary, this.path);
    } finally {
      await unlink(temporary).catch(() => {});
    }
  }
}
