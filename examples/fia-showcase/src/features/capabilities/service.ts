import type { FIAHost } from "@semicoder/fia/backend";
import type { CapabilityItem, CapabilitySnapshot, ScreenInfo } from "../../shared/contracts";

export interface ShortcutState {
  ready: boolean;
  detail: string;
}

function captureCapability(status: string): CapabilityItem {
  return {
    id: "screenCapture",
    name: "屏幕录制与截图",
    status: status === "authorized" ? "authorized" : "notAuthorized",
    detail:
      status === "authorized"
        ? "已授权，可进行整屏和区域截图"
        : "尚未授权；首次授权后 macOS 可能要求重新启动应用",
  };
}

export async function capabilitySnapshot(
  host: FIAHost,
  shortcuts: ShortcutState,
): Promise<CapabilitySnapshot> {
  const [app, screens, windows, captureStatus, notificationStatus] = await Promise.all([
    host.application.getState(),
    host.screens.list() as Promise<ScreenInfo[]>,
    host.webviews.list(),
    host.screenCapture.getAuthorizationStatus(),
    host.notifications.getAuthorizationStatus(),
  ]);
  const notificationAuthorized = ["authorized", "provisional", "ephemeral"].includes(
    notificationStatus,
  );
  return {
    app,
    screens,
    windows: windows.map((window) => ({
      id: window.id,
      visible: window.visible,
      focused: window.focused,
    })),
    shortcuts,
    items: [
      captureCapability(captureStatus),
      {
        id: "notifications",
        name: "系统通知",
        status: notificationAuthorized ? "authorized" : "notAuthorized",
        detail: notificationAuthorized ? "已授权" : `当前状态：${notificationStatus}`,
      },
      {
        id: "files",
        name: "文件与目录面板",
        status: "available",
        detail: "通过用户选择根目录建立明确的文件操作边界",
      },
      {
        id: "clipboard",
        name: "文本与图片剪贴板",
        status: "available",
        detail: "截图可直接复制为图片，搜索结果可复制路径",
      },
      {
        id: "keychain",
        name: "Keychain",
        status: "available",
        detail: "按应用 bundle identifier 隔离",
      },
      {
        id: "shortcuts",
        name: "全局快捷键",
        status: shortcuts.ready ? "available" : "unavailable",
        detail: shortcuts.detail,
      },
      {
        id: "signing",
        name: "运行时签名状态",
        status: "unknown",
        detail: "FIA 尚未向 Backend 暴露 Developer ID / ad-hoc 运行时签名状态；已记录为框架缺口",
      },
      {
        id: "lifecycle",
        name: "Backend / WebSocket 生命周期",
        status: "available",
        detail: "当前能力快照由受保护 HTTP route 返回，页面通过 WebSocket 接收变更事件",
      },
    ],
  };
}
