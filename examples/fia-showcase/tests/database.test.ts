import { describe, expect, test } from "bun:test";
import { ShowcaseRepository } from "../src/lib/database";

describe("SQLite repository", () => {
  test("持久化截图、文件根和搜索历史", () => {
    const repository = new ShowcaseRepository(":memory:");
    const createdAt = new Date().toISOString();
    repository.addScreenshot({
      id: "shot-1",
      path: "/private/tmp/shot.png",
      screenId: "display-1",
      screenName: "主显示器",
      mode: "screen",
      region: null,
      pixelWidth: 1_000,
      pixelHeight: 800,
      byteSize: 512,
      createdAt,
    });
    repository.addRoot({ id: "root-1", path: "/private/tmp", name: "tmp", createdAt });
    repository.recordSearch("报告", 12);
    repository.recordFileLocation("root-1", "资料/报告");

    expect(repository.getScreenshot("shot-1")?.path).toBe("/private/tmp/shot.png");
    expect(repository.listRoots()).toHaveLength(1);
    expect(repository.recentSearches()).toEqual([
      { query: "报告", searchedAt: expect.any(String), resultCount: 12 },
    ]);
    expect(repository.recentFileLocations()).toEqual([
      {
        rootId: "root-1",
        rootName: "tmp",
        relativePath: "资料/报告",
        visitedAt: expect.any(String),
      },
    ]);
    repository.removeRoot("root-1");
    expect(repository.recentFileLocations()).toEqual([]);
    repository.close();
  });
});
