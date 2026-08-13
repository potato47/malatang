import { afterEach, describe, expect, test } from "bun:test";
import type { FIAHost } from "@semicoder/fia/backend";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { ScreenshotService } from "../src/features/screenshots/service";
import { ShowcaseRepository } from "../src/lib/database";

const temporary: string[] = [];
afterEach(
  async () =>
    await Promise.all(
      temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })),
    ),
);

describe("截图服务（注入 Host，不触发系统截图）", () => {
  test("按 DB → 图片剪贴板 → WebSocket 事件顺序完成，且公开 DTO 无绝对路径", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-shot-"));
    temporary.push(root);
    const repository = new ShowcaseRepository(":memory:");
    const order: string[] = [];
    const service = new ScreenshotService(root, repository, () => order.push("event"));
    await service.initialize();
    const host = {
      screens: {
        list: async () => [
          {
            id: "screen",
            name: "主屏",
            frame: { x: 0, y: 0, width: 100, height: 80 },
            visibleFrame: { x: 0, y: 0, width: 100, height: 80 },
            scaleFactor: 2,
            main: true,
            containsPointer: true,
          },
        ],
      },
      screenCapture: {
        getAuthorizationStatus: async () => "authorized",
        capture: async ({ destination }: { destination: string }) => {
          await Bun.write(destination, new Uint8Array([137, 80, 78, 71]));
          order.push("capture");
          return { path: destination, pixelWidth: 200, pixelHeight: 160 };
        },
      },
      clipboard: {
        writeImage: async () => {
          expect(repository.listScreenshots()).toHaveLength(1);
          order.push("clipboard");
        },
      },
      system: { trashPath: async (path: string) => path },
    } as unknown as FIAHost;
    const result = await service.capture(host, { mode: "screen" });
    expect(result).not.toHaveProperty("path");
    expect(order).toEqual(["capture", "clipboard", "event"]);
    repository.close();
  });

  test("授权不足时不调用 capture", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-shot-"));
    temporary.push(root);
    const repository = new ShowcaseRepository(":memory:");
    const service = new ScreenshotService(root, repository, () => {});
    await service.initialize();
    let called = false;
    const host = {
      screens: { list: async () => [] },
      screenCapture: {
        getAuthorizationStatus: async () => "notAuthorized",
        capture: async () => {
          called = true;
        },
      },
    } as unknown as FIAHost;
    await expect(service.capture(host, { mode: "screen" })).rejects.toThrow("请先在能力中心");
    expect(called).toBe(false);
    repository.close();
  });

  test("并发截图被拒绝，且显式失效 screenId 不会回退", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-shot-"));
    temporary.push(root);
    const repository = new ShowcaseRepository(":memory:");
    const service = new ScreenshotService(root, repository, () => {});
    await service.initialize();
    let release!: () => void;
    const gate = new Promise<void>((resolveGate) => {
      release = resolveGate;
    });
    let captureStarted!: () => void;
    const started = new Promise<void>((resolveStarted) => {
      captureStarted = resolveStarted;
    });
    const host = {
      screens: {
        list: async () => [
          {
            id: "screen",
            name: "主屏",
            frame: { x: 0, y: 0, width: 100, height: 80 },
            visibleFrame: { x: 0, y: 0, width: 100, height: 80 },
            scaleFactor: 2,
            main: true,
            containsPointer: true,
          },
        ],
      },
      screenCapture: {
        getAuthorizationStatus: async () => "authorized",
        capture: async ({ destination }: { destination: string }) => {
          captureStarted();
          await gate;
          await Bun.write(destination, "png");
          return { path: destination, pixelWidth: 200, pixelHeight: 160 };
        },
      },
      clipboard: { writeImage: async () => {} },
      system: { trashPath: async (path: string) => path },
    } as unknown as FIAHost;
    const first = service.capture(host, { mode: "screen" });
    await started;
    await expect(service.capture(host, { mode: "screen" })).rejects.toThrow("已有截图任务");
    release();
    await first;
    await expect(service.capture(host, { mode: "screen", screenId: "gone" })).rejects.toThrow(
      "已断开",
    );
    repository.close();
  });

  test("剪贴板失败仍保留 DB 记录并返回安全警告", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-shot-"));
    temporary.push(root);
    const repository = new ShowcaseRepository(":memory:");
    const events: Array<{ type: string }> = [];
    const service = new ScreenshotService(root, repository, (event) => events.push(event));
    await service.initialize();
    const host = {
      screens: {
        list: async () => [
          {
            id: "screen",
            name: "主屏",
            frame: { x: 0, y: 0, width: 10, height: 10 },
            visibleFrame: { x: 0, y: 0, width: 10, height: 10 },
            scaleFactor: 1,
            main: true,
            containsPointer: true,
          },
        ],
      },
      screenCapture: {
        getAuthorizationStatus: async () => "authorized",
        capture: async ({ destination }: { destination: string }) => {
          await Bun.write(destination, "png");
          return { path: destination, pixelWidth: 10, pixelHeight: 10 };
        },
      },
      clipboard: {
        writeImage: async () => {
          throw new Error("/private/secret/path.png");
        },
      },
      system: { trashPath: async (path: string) => path },
    } as unknown as FIAHost;
    const result = await service.capture(host, { mode: "screen" });
    expect(repository.listScreenshots()).toHaveLength(1);
    expect(result.warning).toContain("已保存");
    expect(result.warning).not.toContain("/private");
    expect(events.map((event) => event.type)).toEqual(["screenshot.warning", "screenshot.created"]);
    repository.close();
  });

  test("清理同时执行 30 天与最大数量策略", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-shot-"));
    temporary.push(root);
    const repository = new ShowcaseRepository(":memory:");
    const service = new ScreenshotService(root, repository, () => {});
    await service.initialize();
    const times = [
      new Date(Date.now() - 40 * 86_400_000).toISOString(),
      new Date(Date.now() - 2_000).toISOString(),
      new Date(Date.now() - 1_000).toISOString(),
    ];
    for (const [index, createdAt] of times.entries()) {
      const path = resolve(root, `managed-${index}.png`);
      await writeFile(path, "png");
      repository.addScreenshot({
        id: `shot-${index}`,
        path,
        screenId: "screen",
        screenName: "主屏",
        mode: "screen",
        region: null,
        pixelWidth: 1,
        pixelHeight: 1,
        byteSize: 3,
        createdAt,
      });
    }
    const trashed: string[] = [];
    const host = {
      system: {
        trashPath: async (path: string) => {
          trashed.push(path);
          return path;
        },
      },
    } as unknown as FIAHost;
    expect(await service.cleanup(host, { maxAgeDays: 30, maxCount: 1 })).toEqual({ removed: 2 });
    expect(trashed).toHaveLength(2);
    expect(repository.listScreenshots().map((record) => record.id)).toEqual(["shot-2"]);
    repository.close();
  });

  test("dispose 取消在途 Host 调用并等待 capture 收尾", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "fia-showcase-shot-"));
    temporary.push(root);
    const repository = new ShowcaseRepository(":memory:");
    const service = new ScreenshotService(root, repository, () => {});
    await service.initialize();
    let started!: () => void;
    const captureStarted = new Promise<void>((resolveStarted) => {
      started = resolveStarted;
    });
    const host = {
      screens: {
        list: async () => [
          {
            id: "screen",
            name: "主屏",
            frame: { x: 0, y: 0, width: 10, height: 10 },
            visibleFrame: { x: 0, y: 0, width: 10, height: 10 },
            scaleFactor: 1,
            main: true,
            containsPointer: true,
          },
        ],
      },
      screenCapture: {
        getAuthorizationStatus: async () => "authorized",
        capture: async (_input: unknown, options: { signal?: AbortSignal }) => {
          started();
          await new Promise<void>((_resolve, reject) => {
            options.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Aborted", "AbortError")),
              { once: true },
            );
          });
          throw new Error("unreachable");
        },
      },
    } as unknown as FIAHost;
    const outcome = service.capture(host, { mode: "screen" }).catch((error) => error as Error);
    await captureStarted;
    await service.dispose();
    expect(await outcome).toBeInstanceOf(Error);
    expect(repository.listScreenshots()).toHaveLength(0);
    repository.close();
  });
});
