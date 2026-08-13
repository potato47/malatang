import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { SpotlightSearchService } from "../src/features/search/service";
import { ShowcaseRepository } from "../src/lib/database";

const temporary: string[] = [];
afterEach(
  async () =>
    await Promise.all(
      temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    ),
);

const metadata = `kMDItemDisplayName = "中文报告"
kMDItemContentType = "public.plain-text"
kMDItemKind = "纯文本文稿"
kMDItemAuthors = (
    "张三"
)
kMDItemUserTags = (
    "重要"
)
`;

describe("Spotlight 服务（注入进程，不访问真实索引）", () => {
  test("指定 scope、中文路径与 NUL 输出均被正确处理", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-search-"));
    temporary.push(root);
    const path = resolve(root, "中文 报告.txt");
    await writeFile(path, "内容");
    const repository = new ShowcaseRepository(":memory:");
    repository.addRoot({
      id: "root",
      name: "范围",
      path: root,
      createdAt: new Date().toISOString(),
    });
    const calls: string[][] = [];
    const service = new SpotlightSearchService(repository, (argumentsList) => {
      calls.push(argumentsList);
      return argumentsList[0] === "/usr/bin/mdfind"
        ? Bun.spawn(["/usr/bin/printf", "%s\\0", path], {
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          })
        : Bun.spawn(["/usr/bin/printf", "%s", metadata], {
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          });
    });
    const response = await service.search({ query: "报告", rootIds: ["root"] });
    expect(calls[0]).toContain("-onlyin");
    expect(calls[0]).toContain(root);
    expect(response.results[0]).toMatchObject({
      name: "中文报告",
      authors: ["张三"],
      tags: ["重要"],
    });
    expect(response.results[0]).not.toHaveProperty("path");
    repository.close();
  });

  test("无效 rootId fail-closed，mdfind 非零退出映射为安全错误", async () => {
    const repository = new ShowcaseRepository(":memory:");
    let calls = 0;
    const service = new SpotlightSearchService(repository, () => {
      calls += 1;
      return Bun.spawn(["/usr/bin/false"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    });
    await expect(service.search({ query: "a", rootIds: ["missing"] })).rejects.toThrow("不存在");
    expect(calls).toBe(0);
    await expect(service.search({ query: "a" })).rejects.toThrow("Spotlight 搜索失败");
    repository.close();
  });

  test("新 generation 杀死旧进程并丢弃迟到结果，dispose 同样取消", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-search-"));
    temporary.push(root);
    const path = resolve(root, "result.txt");
    await writeFile(path, "result");
    const repository = new ShowcaseRepository(":memory:");
    let mdfindCalls = 0;
    const service = new SpotlightSearchService(repository, (argumentsList) => {
      if (argumentsList[0] === "/usr/bin/mdfind") {
        mdfindCalls += 1;
        if (mdfindCalls === 1 || mdfindCalls === 3)
          return Bun.spawn(["/bin/sleep", "1"], {
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
          });
        return Bun.spawn(["/usr/bin/printf", "%s\\0", path], {
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
      }
      return Bun.spawn(["/usr/bin/printf", "%s", metadata], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
      });
    });
    const firstOutcome = service.search({ query: "旧" }).catch((error) => error as Error);
    await Bun.sleep(20);
    expect((await service.search({ query: "新" })).results).toHaveLength(1);
    const firstResult = await firstOutcome;
    expect(firstResult).toBeInstanceOf(Error);
    if (!(firstResult instanceof Error)) throw new Error("旧查询意外成功");
    expect(firstResult.message).toContain("更新的查询替代");

    const disposedOutcome = service.search({ query: "取消" }).catch((error) => error as Error);
    await Bun.sleep(20);
    service.dispose();
    const disposedResult = await disposedOutcome;
    expect(disposedResult).toBeInstanceOf(Error);
    if (!(disposedResult instanceof Error)) throw new Error("已取消查询意外成功");
    expect(disposedResult.message).toContain("更新的查询替代");
    repository.close();
  });
});
