import { describe, expect, test } from "bun:test";
import { normalizeCaptureRegion } from "../src/features/screenshots/region";

describe("截图区域", () => {
  test("把选区裁剪到当前显示器的逻辑点范围", () => {
    expect(
      normalizeCaptureRegion(
        { width: 100, height: 80 },
        {
          x: -10,
          y: 20,
          width: 140,
          height: 100,
        },
      ),
    ).toEqual({ x: 0, y: 20, width: 100, height: 60 });
  });

  test("拒绝非有限值和过小选区", () => {
    expect(() =>
      normalizeCaptureRegion(
        { width: 100, height: 80 },
        {
          x: 1,
          y: 1,
          width: Number.NaN,
          height: 10,
        },
      ),
    ).toThrow("有限数字");
    expect(() =>
      normalizeCaptureRegion(
        { width: 100, height: 80 },
        {
          x: 1,
          y: 1,
          width: 2,
          height: 2,
        },
      ),
    ).toThrow("至少需要 4 × 4");
  });

  test("小数选区取整后仍完全位于显示器边界内", () => {
    const region = normalizeCaptureRegion(
      { width: 100, height: 80 },
      { x: 95.005, y: 74.005, width: 4.995, height: 5.995 },
    );
    expect(region).toEqual({ x: 95.01, y: 74.01, width: 4.99, height: 5.99 });
    expect(region.x + region.width).toBeLessThanOrEqual(100);
    expect(region.y + region.height).toBeLessThanOrEqual(80);
  });
});
