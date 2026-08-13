import type { FIAHost } from "@semicoder/fia/backend";
import { lstat, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { ShowcaseRepository, type StoredScreenshotRecord } from "../../lib/database";
import { AppError } from "../../lib/http";
import type { AppEvent, ScreenInfo, ScreenshotRecord } from "../../shared/contracts";
import { normalizeCaptureRegion } from "./region";

export interface CaptureRequest {
  screenId?: string;
  mode?: "screen" | "region";
  region?: unknown;
  showsCursor?: boolean;
  copyToClipboard?: boolean;
}

function captureName(id: string): string {
  const timestamp = new Date().toISOString().replaceAll(/[:.]/g, "-");
  return `${timestamp}-${id.slice(0, 8)}.png`;
}

export class ScreenshotService {
  readonly #directory: string;
  #capturing = false;
  #selecting = false;
  #captureController: AbortController | null = null;
  #captureCompletion: Promise<void> | null = null;

  constructor(
    dataDirectory: string,
    private readonly repository: ShowcaseRepository,
    private readonly publish: (event: AppEvent) => void,
  ) {
    this.#directory = resolve(dataDirectory, "screenshots");
  }

  async initialize(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
  }

  beginSelection(): void {
    if (this.#capturing || this.#selecting) {
      throw new AppError("CAPTURE_IN_PROGRESS", "已有截图任务正在进行", 409);
    }
    this.#selecting = true;
  }

  cancelSelection(): void {
    this.#selecting = false;
  }

  async dispose(): Promise<void> {
    this.#selecting = false;
    this.#captureController?.abort();
    await this.#captureCompletion;
  }

  list(limit = 100): ScreenshotRecord[] {
    return this.repository
      .listScreenshots(Math.min(Math.max(limit, 1), 500))
      .map(({ path: _path, ...record }) => record);
  }

  get(id: string): StoredScreenshotRecord {
    const record = this.repository.getScreenshot(id);
    if (record === null) throw new AppError("NOT_FOUND", "截图记录不存在", 404);
    return record;
  }

  publicRecord(id: string): ScreenshotRecord {
    const { path: _path, ...record } = this.get(id);
    return record;
  }

  async capture(host: FIAHost, input: CaptureRequest): Promise<ScreenshotRecord> {
    if (this.#capturing || (this.#selecting && input.mode !== "region")) {
      throw new AppError("CAPTURE_IN_PROGRESS", "已有截图任务正在进行", 409);
    }
    if (input.mode === "region") this.#selecting = false;
    this.#capturing = true;
    const controller = new AbortController();
    this.#captureController = controller;
    let complete!: () => void;
    this.#captureCompletion = new Promise<void>((resolveCompletion) => {
      complete = resolveCompletion;
    });
    let destination: string | null = null;
    let persisted = false;
    try {
      // Start both calls at the trigger boundary so pointer-screen selection is
      // sampled before any permission/status round-trip can introduce drift.
      const [authorization, screensValue] = await Promise.all([
        host.screenCapture.getAuthorizationStatus(),
        host.screens.list(),
      ]);
      if (authorization !== "authorized") {
        throw new AppError(
          "SCREEN_CAPTURE_NOT_AUTHORIZED",
          "请先在能力中心授予屏幕录制权限；授权后可能需要重新启动应用",
          403,
          { authorization },
        );
      }
      const screens = screensValue as ScreenInfo[];
      if (screens.length === 0) throw new AppError("NO_SCREEN", "没有可用于截图的显示器", 409);
      const explicitScreen =
        input.screenId === undefined
          ? undefined
          : screens.find((item) => item.id === input.screenId);
      if (input.screenId !== undefined && explicitScreen === undefined) {
        throw new AppError("SCREEN_NOT_FOUND", "所选显示器已断开，请重新选择", 404);
      }
      const screen =
        explicitScreen ??
        screens.find((item) => item.containsPointer) ??
        screens.find((item) => item.main) ??
        screens[0]!;
      const mode = input.mode ?? "screen";
      if (mode !== "screen" && mode !== "region")
        throw new AppError("INVALID_MODE", "截图模式无效");
      const region = mode === "region" ? normalizeCaptureRegion(screen.frame, input.region) : null;
      const id = crypto.randomUUID();
      destination = resolve(this.#directory, captureName(id));
      const receipt = await host.screenCapture.capture(
        {
          screenId: screen.id,
          ...(region === null ? {} : { region }),
          destination,
          showsCursor: input.showsCursor ?? false,
        },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) {
        throw new AppError("CAPTURE_CANCELLED", "截图因应用停止而取消", 409);
      }
      const information = await lstat(receipt.path);
      const record: StoredScreenshotRecord = {
        id,
        path: receipt.path,
        screenId: screen.id,
        screenName: screen.name,
        mode,
        region,
        pixelWidth: receipt.pixelWidth,
        pixelHeight: receipt.pixelHeight,
        byteSize: information.size,
        createdAt: new Date().toISOString(),
      };
      this.repository.addScreenshot(record);
      persisted = true;
      const { path: _path, ...publicRecord } = record;
      if (input.copyToClipboard ?? true) {
        try {
          await host.clipboard.writeImage(record.path);
        } catch (error) {
          console.warn("截图已保存，但复制图片到剪贴板失败", error);
          publicRecord.warning = "截图已保存，但复制图片到剪贴板失败；可在历史记录中重试";
          this.publish({ type: "screenshot.warning", message: publicRecord.warning });
        }
      }
      this.publish({ type: "screenshot.created", screenshot: publicRecord });
      const settings = this.repository.settings();
      await this.cleanup(host, {
        maxAgeDays: settings.screenshotMaxAgeDays,
        maxCount: settings.screenshotMaxCount,
      });
      return publicRecord;
    } catch (error) {
      if (!persisted && destination !== null) await rm(destination, { force: true });
      throw error;
    } finally {
      this.#capturing = false;
      if (this.#captureController === controller) this.#captureController = null;
      complete();
      this.#captureCompletion = null;
    }
  }

  async trash(host: FIAHost, id: string): Promise<{ trashed: true }> {
    const record = this.get(id);
    try {
      await lstat(record.path);
      await host.system.trashPath(record.path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    this.repository.removeScreenshot(id);
    this.publish({ type: "screenshots.changed" });
    return { trashed: true };
  }

  async cleanup(
    host: FIAHost,
    policy: { maxAgeDays?: number; maxCount?: number } = {},
  ): Promise<{ removed: number }> {
    const maxAgeDays = Math.min(Math.max(Math.floor(policy.maxAgeDays ?? 30), 1), 365);
    const maxCount = Math.min(Math.max(Math.floor(policy.maxCount ?? 500), 1), 500);
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60_000;
    const allRecords = this.repository.listScreenshots(10_000);
    const records = allRecords.filter(
      (record, index) => index >= maxCount || Date.parse(record.createdAt) < cutoff,
    );
    let removed = 0;
    for (const record of records) {
      try {
        await this.trash(host, record.id);
        removed += 1;
      } catch (error) {
        console.warn(`无法清理截图 ${record.path}`, error);
      }
    }
    if (removed > 0) this.publish({ type: "screenshots.changed" });
    return { removed };
  }
}
