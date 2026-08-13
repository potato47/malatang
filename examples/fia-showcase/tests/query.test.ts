import { describe, expect, test } from "bun:test";
import { AppError } from "../src/lib/http";
import { buildSpotlightQuery, normalizeSearchText } from "../src/features/search/query";

describe("Spotlight 查询", () => {
  test("按词 AND、按元数据字段 OR，且不搜索正文", () => {
    const query = buildSpotlightQuery("季度 报告");
    expect(query).toContain(" && ");
    expect(query).toContain("kMDItemFSName");
    expect(query).toContain("kMDItemDisplayName");
    expect(query).toContain("kMDItemContentType");
    expect(query).toContain("kMDItemAuthors");
    expect(query).toContain("kMDItemUserTags");
    expect(query).not.toContain("kMDItemTextContent");
  });

  test("接受单字符、转义 native query 字符并限制 256 字符", () => {
    expect(normalizeSearchText("  a  ")).toBe("a");
    expect(buildSpotlightQuery('a"b*c?d')).toContain('a\\"b\\*c\\?d');
    expect(() => normalizeSearchText(" ")).toThrow(AppError);
    expect(() => normalizeSearchText("x".repeat(257))).toThrow("最多 256");
    expect(() => normalizeSearchText("foo\nbar")).toThrow("控制字符");
    expect(() => normalizeSearchText("foo\0bar")).toThrow("控制字符");
  });
});
