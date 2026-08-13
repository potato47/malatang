import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import type {
  FileRoot,
  ScreenshotRecord,
  ScreenFrame,
  ShowcaseSettings,
} from "../shared/contracts";

export interface StoredScreenshotRecord extends ScreenshotRecord {
  path: string;
}

export interface StoredFileRoot extends FileRoot {
  path: string;
}

interface ScreenshotRow {
  id: string;
  path: string;
  screen_id: string;
  screen_name: string;
  mode: "screen" | "region";
  region_json: string | null;
  pixel_width: number;
  pixel_height: number;
  byte_size: number;
  created_at: string;
}

interface FileRootRow {
  id: string;
  path: string;
  created_at: string;
}

const schema = `
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS screenshots (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    screen_id TEXT NOT NULL,
    screen_name TEXT NOT NULL,
    mode TEXT NOT NULL CHECK (mode IN ('screen', 'region')),
    region_json TEXT,
    pixel_width INTEGER NOT NULL CHECK (pixel_width > 0),
    pixel_height INTEGER NOT NULL CHECK (pixel_height > 0),
    byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS screenshots_created_at ON screenshots(created_at DESC);
  CREATE TABLE IF NOT EXISTS file_roots (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS search_history (
    query TEXT PRIMARY KEY,
    searched_at TEXT NOT NULL,
    result_count INTEGER NOT NULL CHECK (result_count >= 0)
  );
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS recent_file_locations (
    root_id TEXT NOT NULL REFERENCES file_roots(id) ON DELETE CASCADE,
    relative_path TEXT NOT NULL,
    visited_at TEXT NOT NULL,
    PRIMARY KEY (root_id, relative_path)
  );
  CREATE INDEX IF NOT EXISTS recent_file_locations_visited_at
    ON recent_file_locations(visited_at DESC);
  PRAGMA user_version = 2;
`;

export const defaultSettings: ShowcaseSettings = {
  searchShortcut: { key: "space", modifiers: ["option"] },
  captureShortcut: { key: "4", modifiers: ["control", "shift"] },
  screenshotMaxAgeDays: 30,
  screenshotMaxCount: 500,
};

function screenshotFromRow(row: ScreenshotRow): StoredScreenshotRecord {
  return {
    id: row.id,
    path: row.path,
    screenId: row.screen_id,
    screenName: row.screen_name,
    mode: row.mode,
    region: row.region_json === null ? null : (JSON.parse(row.region_json) as ScreenFrame),
    pixelWidth: row.pixel_width,
    pixelHeight: row.pixel_height,
    byteSize: row.byte_size,
    createdAt: row.created_at,
  };
}

function rootFromRow(row: FileRootRow): StoredFileRoot {
  return {
    id: row.id,
    path: row.path,
    name: basename(row.path) || "Macintosh HD",
    createdAt: row.created_at,
  };
}

export class ShowcaseRepository {
  readonly #database: Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(resolve(path)), { recursive: true });
    this.#database = new Database(path, { create: true, readwrite: true, strict: true });
    this.#database.exec(schema);
  }

  close(): void {
    this.#database.close();
  }

  addScreenshot(record: StoredScreenshotRecord): void {
    this.#database
      .query<
        never,
        {
          id: string;
          path: string;
          screenId: string;
          screenName: string;
          mode: string;
          region: string | null;
          pixelWidth: number;
          pixelHeight: number;
          byteSize: number;
          createdAt: string;
        }
      >(`
        INSERT INTO screenshots (
          id, path, screen_id, screen_name, mode, region_json,
          pixel_width, pixel_height, byte_size, created_at
        ) VALUES (
          $id, $path, $screenId, $screenName, $mode, $region,
          $pixelWidth, $pixelHeight, $byteSize, $createdAt
        )
      `)
      .run({
        id: record.id,
        path: record.path,
        screenId: record.screenId,
        screenName: record.screenName,
        mode: record.mode,
        region: record.region === null ? null : JSON.stringify(record.region),
        pixelWidth: record.pixelWidth,
        pixelHeight: record.pixelHeight,
        byteSize: record.byteSize,
        createdAt: record.createdAt,
      });
  }

  listScreenshots(limit = 100): StoredScreenshotRecord[] {
    const rows = this.#database
      .query<ScreenshotRow, [number]>(`
        SELECT id, path, screen_id, screen_name, mode, region_json,
               pixel_width, pixel_height, byte_size, created_at
        FROM screenshots ORDER BY created_at DESC LIMIT ?
      `)
      .all(limit);
    return rows.map(screenshotFromRow);
  }

  getScreenshot(id: string): StoredScreenshotRecord | null {
    const row = this.#database
      .query<ScreenshotRow, [string]>(`
        SELECT id, path, screen_id, screen_name, mode, region_json,
               pixel_width, pixel_height, byte_size, created_at
        FROM screenshots WHERE id = ?
      `)
      .get(id);
    return row === null ? null : screenshotFromRow(row);
  }

  removeScreenshot(id: string): boolean {
    return (
      this.#database.query<never, [string]>("DELETE FROM screenshots WHERE id = ?").run(id)
        .changes > 0
    );
  }

  addRoot(root: StoredFileRoot): void {
    this.#database
      .query<never, { id: string; path: string; createdAt: string }>(`
        INSERT INTO file_roots (id, path, created_at) VALUES ($id, $path, $createdAt)
        ON CONFLICT(path) DO NOTHING
      `)
      .run({ id: root.id, path: root.path, createdAt: root.createdAt });
  }

  listRoots(): StoredFileRoot[] {
    return this.#database
      .query<FileRootRow, []>("SELECT id, path, created_at FROM file_roots ORDER BY created_at")
      .all()
      .map(rootFromRow);
  }

  getRoot(id: string): StoredFileRoot | null {
    const row = this.#database
      .query<FileRootRow, [string]>("SELECT id, path, created_at FROM file_roots WHERE id = ?")
      .get(id);
    return row === null ? null : rootFromRow(row);
  }

  removeRoot(id: string): boolean {
    return (
      this.#database.query<never, [string]>("DELETE FROM file_roots WHERE id = ?").run(id).changes >
      0
    );
  }

  recordFileLocation(rootId: string, relativePath: string): void {
    this.#database
      .query<never, { rootId: string; relativePath: string; visitedAt: string }>(`
        INSERT INTO recent_file_locations (root_id, relative_path, visited_at)
        VALUES ($rootId, $relativePath, $visitedAt)
        ON CONFLICT(root_id, relative_path) DO UPDATE SET visited_at = excluded.visited_at
      `)
      .run({ rootId, relativePath, visitedAt: new Date().toISOString() });
    this.#database.exec(`
      DELETE FROM recent_file_locations
      WHERE (root_id, relative_path) NOT IN (
        SELECT root_id, relative_path FROM recent_file_locations
        ORDER BY visited_at DESC LIMIT 12
      )
    `);
  }

  recentFileLocations(limit = 8): Array<{
    rootId: string;
    rootName: string;
    relativePath: string;
    visitedAt: string;
  }> {
    return this.#database
      .query<
        { root_id: string; root_path: string; relative_path: string; visited_at: string },
        [number]
      >(`
        SELECT locations.root_id, roots.path AS root_path,
               locations.relative_path, locations.visited_at
        FROM recent_file_locations AS locations
        JOIN file_roots AS roots ON roots.id = locations.root_id
        ORDER BY locations.visited_at DESC LIMIT ?
      `)
      .all(limit)
      .map((row) => ({
        rootId: row.root_id,
        rootName: basename(row.root_path) || "Macintosh HD",
        relativePath: row.relative_path,
        visitedAt: row.visited_at,
      }));
  }

  recordSearch(query: string, resultCount: number): void {
    this.#database
      .query<never, { query: string; searchedAt: string; resultCount: number }>(`
        INSERT INTO search_history (query, searched_at, result_count)
        VALUES ($query, $searchedAt, $resultCount)
        ON CONFLICT(query) DO UPDATE SET
          searched_at = excluded.searched_at,
          result_count = excluded.result_count
      `)
      .run({ query, searchedAt: new Date().toISOString(), resultCount });
  }

  recentSearches(limit = 8): Array<{ query: string; searchedAt: string; resultCount: number }> {
    return this.#database
      .query<{ query: string; searched_at: string; result_count: number }, [number]>(
        "SELECT query, searched_at, result_count FROM search_history ORDER BY searched_at DESC LIMIT ?",
      )
      .all(limit)
      .map((row) => ({
        query: row.query,
        searchedAt: row.searched_at,
        resultCount: row.result_count,
      }));
  }

  settings(): ShowcaseSettings {
    const row = this.#database
      .query<{ value_json: string }, [string]>("SELECT value_json FROM settings WHERE key = ?")
      .get("showcase");
    if (row === null) return structuredClone(defaultSettings);
    return {
      ...structuredClone(defaultSettings),
      ...(JSON.parse(row.value_json) as Partial<ShowcaseSettings>),
    };
  }

  saveSettings(settings: ShowcaseSettings): void {
    this.#database
      .query<never, { value: string; updatedAt: string }>(`
        INSERT INTO settings (key, value_json, updated_at) VALUES ('showcase', $value, $updatedAt)
        ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
      `)
      .run({ value: JSON.stringify(settings), updatedAt: new Date().toISOString() });
  }
}
