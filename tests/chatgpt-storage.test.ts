import { afterEach, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGPT } from "../backend/chatgpt";
import { ChatGPTStorage } from "../backend/chatgpt-storage";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await fs.rm(directory, { recursive: true, force: true });
});
async function directory() {
  const root = await fs.mkdtemp(join(tmpdir(), "malatang-credentials-"));
  directories.push(root);
  return join(root, "data");
}
function auth(storage: ChatGPTStorage, changed = () => {}) {
  return new ChatGPT({
    readSecret: () => storage.readSecret(),
    writeSecret: (value) => storage.writeSecret(value),
    redirectURI: "http://127.0.0.1:54873/api/oauth/openai/callback",
    openURL: async () => {},
    changed,
  });
}

test("first use and restart keep a private file and stable host identity, isolated by data directory", async () => {
  const dir = await directory();
  const storage = new ChatGPTStorage(dir);
  expect(await storage.readSecret()).toBeNull();
  const first = auth(storage);
  await first.open();
  const saved = JSON.parse((await storage.readSecret())!);
  expect(saved).toMatchObject({ version: 1, activeProfileId: null, profiles: [] });
  expect(saved.hostId).toMatch(/^urn:uuid:/);
  expect(first.status().available).toBe(true);
  expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
  expect((await fs.stat(join(dir, "chatgpt-auth.json"))).mode & 0o777).toBe(0o600);
  await first.stop();
  const reopened = auth(new ChatGPTStorage(dir));
  await reopened.open();
  expect(JSON.parse((await storage.readSecret())!)).toEqual(saved);
  const other = new ChatGPTStorage(await directory());
  await auth(other).open();
  expect(JSON.parse((await other.readSecret())!).hostId).not.toBe(saved.hostId);
  await reopened.stop();
});

test("reading an existing credential file repairs overly broad file and directory permissions", async () => {
  const dir = await directory();
  const storage = new ChatGPTStorage(dir);
  await storage.writeSecret("saved");
  await fs.chmod(dir, 0o755);
  await fs.chmod(join(dir, "chatgpt-auth.json"), 0o644);
  expect(await storage.readSecret()).toBe("saved");
  expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
  expect((await fs.stat(join(dir, "chatgpt-auth.json"))).mode & 0o777).toBe(0o600);
});

test("atomic replacement uses a private temporary file and cleans it on failure without replacing saved bytes", async () => {
  const dir = await directory();
  const storage = new ChatGPTStorage(dir);
  await storage.writeSecret("previous");
  const before = await fs.stat(join(dir, "chatgpt-auth.json"));
  const realRename = fs.rename;
  let temporary = "";
  const replacement = spyOn(fs, "rename").mockImplementation(async (source, destination) => {
    temporary = String(source);
    expect((await fs.stat(source)).mode & 0o777).toBe(0o600);
    expect(await fs.readFile(source, "utf8")).toBe("candidate");
    expect(await fs.readFile(destination, "utf8")).toBe("previous");
    throw new Error("disk unavailable");
  });
  try {
    await expect(storage.writeSecret("candidate")).rejects.toThrow("disk unavailable");
  } finally {
    replacement.mockRestore();
  }
  expect(temporary).not.toBe("");
  expect(await fs.readFile(join(dir, "chatgpt-auth.json"), "utf8")).toBe("previous");
  expect(await fs.readdir(dir)).toEqual(["chatgpt-auth.json"]);
  expect(fs.rename).toBe(realRename);
  await storage.writeSecret("committed");
  expect(await storage.readSecret()).toBe("committed");
  expect((await fs.stat(join(dir, "chatgpt-auth.json"))).ino).not.toBe(before.ino);
  expect(await fs.readdir(dir)).toEqual(["chatgpt-auth.json"]);
});

for (const content of [
  "",
  "{broken-json",
  JSON.stringify({ version: 2, secret: "must-not-leak" }),
]) {
  test(`invalid credential file (${content ? "nonempty" : "empty"}) disables login and is never overwritten`, async () => {
    const dir = await directory();
    const storage = new ChatGPTStorage(dir);
    await storage.writeSecret(content);
    let events = 0;
    const account = auth(storage, () => {
      events++;
    });
    await account.open();
    expect(account.status()).toMatchObject({
      available: false,
      profiles: [],
      activeProfileId: null,
    });
    expect(account.status().message).toContain("凭证文件");
    expect(account.status().message).not.toContain("must-not-leak");
    await expect(account.signIn()).rejects.toThrow("凭证文件");
    await expect(account.rename("missing", "name")).rejects.toThrow("凭证文件");
    expect(await storage.readSecret()).toBe(content);
    expect(events).toBe(0);
    await account.stop();
  });
}

test("unreadable credentials and symbolic links disable login without replacing the source", async () => {
  const dir = await directory();
  const storage = new ChatGPTStorage(dir);
  await storage.writeSecret("private-saved-bytes");
  const path = join(dir, "chatgpt-auth.json");
  await fs.chmod(path, 0o000);
  try {
    await expect(storage.readSecret()).rejects.toMatchObject({ code: "EACCES" });
    const account = auth(storage);
    await account.open();
    expect(account.status().available).toBe(false);
    await expect(account.signIn()).rejects.toThrow("数据目录权限");
  } finally {
    await fs.chmod(path, 0o600);
  }
  expect(await storage.readSecret()).toBe("private-saved-bytes");
  const target = join(dir, "existing.json");
  await fs.rename(path, target);
  await fs.symlink(target, path);
  const account = auth(storage);
  await account.open();
  expect(account.status().available).toBe(false);
  expect(await fs.readFile(target, "utf8")).toBe("private-saved-bytes");
  expect((await fs.lstat(path)).isSymbolicLink()).toBe(true);
});
