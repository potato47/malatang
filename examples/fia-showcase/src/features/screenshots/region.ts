import { AppError } from "../../lib/http";
import type { ScreenFrame } from "../../shared/contracts";

function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AppError("INVALID_REGION", `${label} 必须是有限数字`);
  }
  return value;
}

export function normalizeCaptureRegion(
  screen: Pick<ScreenFrame, "width" | "height">,
  value: unknown,
): ScreenFrame {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("INVALID_REGION", "截图区域格式不正确");
  }
  const candidate = value as Record<string, unknown>;
  const left = Math.max(0, finite(candidate.x, "x"));
  const top = Math.max(0, finite(candidate.y, "y"));
  const right = Math.min(screen.width, left + finite(candidate.width, "width"));
  const bottom = Math.min(screen.height, top + finite(candidate.height, "height"));
  const region = {
    x: Math.round(left * 100) / 100,
    y: Math.round(top * 100) / 100,
    width: Math.round((right - left) * 100) / 100,
    height: Math.round((bottom - top) * 100) / 100,
  };
  if (region.width < 4 || region.height < 4) {
    throw new AppError("REGION_TOO_SMALL", "截图区域至少需要 4 × 4 点");
  }
  return region;
}
