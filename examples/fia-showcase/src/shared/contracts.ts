export type WindowName = "home" | "screenshots" | "search" | "files" | "capabilities";

export interface APIErrorPayload {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export interface ScreenFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenInfo {
  id: string;
  name: string;
  frame: ScreenFrame;
  visibleFrame: ScreenFrame;
  scaleFactor: number;
  main: boolean;
  containsPointer: boolean;
}

export interface ScreenshotRecord {
  id: string;
  screenId: string;
  screenName: string;
  mode: "screen" | "region";
  region: ScreenFrame | null;
  pixelWidth: number;
  pixelHeight: number;
  byteSize: number;
  createdAt: string;
  warning?: string;
}

export interface SearchResult {
  token: string;
  name: string;
  locationLabel: string;
  kind: "file" | "directory" | "other";
  size: number | null;
  modifiedAt: string | null;
  createdAt: string | null;
  contentType: string | null;
  kindLabel: string | null;
  authors: string[];
  tags: string[];
}

export interface SearchResponse {
  query: string;
  results: SearchResult[];
  elapsedMs: number;
  truncated: boolean;
}

export interface FileRoot {
  id: string;
  name: string;
  createdAt: string;
}

export interface RecentFileLocation {
  rootId: string;
  rootName: string;
  relativePath: string;
  visitedAt: string;
}

export interface FileEntry {
  relativePath: string;
  name: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number | null;
  modifiedAt: string;
  hidden: boolean;
  extension: string;
}

export interface DirectoryListing {
  root: FileRoot;
  relativePath: string;
  parentRelativePath: string | null;
  entries: FileEntry[];
  truncated: boolean;
}

export type PreviewKind = "image" | "pdf" | "text" | "unsupported";

export interface FilePreview {
  rootId: string;
  relativePath: string;
  name: string;
  kind: PreviewKind;
  mimeType: string;
  size: number;
  modifiedAt: string;
  text?: string;
  truncated?: boolean;
  contentURL?: string;
}

export interface CapabilityItem {
  id: string;
  name: string;
  status: "available" | "authorized" | "notAuthorized" | "unavailable" | "unknown";
  detail: string;
}

export interface CapabilitySnapshot {
  app: { dockVisible: boolean; trayVisible: boolean };
  screens: ScreenInfo[];
  windows: Array<{ id: string; visible: boolean; focused: boolean }>;
  shortcuts: { ready: boolean; detail: string };
  items: CapabilityItem[];
}

export interface ShowcaseSettings {
  searchShortcut: { key: string; modifiers: Array<"command" | "option" | "control" | "shift"> };
  captureShortcut: { key: string; modifiers: Array<"command" | "option" | "control" | "shift"> };
  screenshotMaxAgeDays: number;
  screenshotMaxCount: number;
}

export type AppEvent =
  | { type: "ready"; timestamp: string }
  | { type: "connection.changed"; state: "connecting" | "connected" | "reconnecting" }
  | { type: "screenshot.created"; screenshot: ScreenshotRecord }
  | { type: "screenshot.warning"; message: string }
  | { type: "screenshots.changed" }
  | { type: "files.changed"; rootId?: string; path?: string }
  | { type: "capabilities.changed" };
