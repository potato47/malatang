import { describe, expect, test } from "bun:test";
import { visibleRange } from "../src/ui/virtual";

describe("文件列表虚拟滚动", () => {
  test("只渲染视口与 overscan，并保持总高度", () => {
    const range = visibleRange(1_000, 3_900, 390, 39, 5);
    expect(range).toEqual({ start: 95, end: 115, paddingTop: 3_705, paddingBottom: 34_515 });
    expect(range.paddingTop + (range.end - range.start) * 39 + range.paddingBottom).toBe(39_000);
  });

  test("空列表返回空范围", () => {
    expect(visibleRange(0, 0, 500, 39)).toEqual({
      start: 0,
      end: 0,
      paddingTop: 0,
      paddingBottom: 0,
    });
  });
});
