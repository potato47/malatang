import { AppError } from "../../lib/http";

export function normalizeSearchText(value: unknown): string {
  if (typeof value !== "string") throw new AppError("INVALID_QUERY", "搜索词必须是字符串");
  if (["\u0000", "\r", "\n", "\u2028", "\u2029"].some((character) => value.includes(character))) {
    throw new AppError("INVALID_QUERY", "搜索词不能包含换行或控制字符");
  }
  const query = value.trim().replaceAll(/\s+/g, " ");
  if (query.length === 0) throw new AppError("QUERY_EMPTY", "请输入搜索内容");
  if (query.length > 256) throw new AppError("QUERY_TOO_LONG", "搜索词最多 256 个字符");
  return query;
}

export function buildSpotlightQuery(value: unknown): string {
  const query = normalizeSearchText(value);
  const fields = [
    "kMDItemFSName",
    "kMDItemDisplayName",
    "kMDItemKind",
    "kMDItemContentType",
    "kMDItemAuthors",
    "kMDItemUserTags",
  ];
  return query
    .split(" ")
    .map((term) => {
      const escaped = term.replaceAll(/[\\"*?]/g, (character) => `\\${character}`);
      return `(${fields.map((field) => `${field} == "*${escaped}*"cd`).join(" || ")})`;
    })
    .join(" && ");
}
