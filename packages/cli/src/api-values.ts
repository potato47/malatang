/** Shared API messages (including their envelope) are limited to 1 MiB of UTF-8. */
export const API_MAX_BYTES = 1024 * 1024;
export type JSONScalar = string | number | boolean | null;
export interface EventOptions {
  /** Top-level payload fields, compared using scalar equality; all fields must match. */
  match?: Readonly<Record<string, JSONScalar>>;
}
export interface EventSubscription extends EventOptions {
  event: string;
}

export function assertJSON(value: unknown, path = "value", seen = new Set<object>()): void {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  )
    return;
  if (typeof value !== "object" || seen.has(value))
    throw new TypeError(`API values must be JSON serializable at ${path}`);
  if (
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) !== Object.prototype &&
    Object.getPrototypeOf(value) !== null
  )
    throw new TypeError(`API values must be plain JSON at ${path}`);
  seen.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertJSON(value[i], `${path}[${i}]`, seen);
  } else {
    for (const [key, child] of Object.entries(value)) {
      if (child === undefined) continue;
      const field = /^[A-Za-z_$][\w$]*$/u.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
      assertJSON(child, path + field, seen);
    }
  }
  seen.delete(value);
}

export function parseEventMatch(value: unknown): Readonly<Record<string, JSONScalar>> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new TypeError("Event match must be an object of top-level JSON scalar fields");
  assertJSON(value, "match");
  for (const child of Object.values(value))
    if (child !== null && !["string", "number", "boolean"].includes(typeof child))
      throw new TypeError("Event match values must be JSON scalars");
  return Object.fromEntries(Object.entries(value)) as Record<string, JSONScalar>;
}

export function matchesEvent(subscription: EventSubscription, event: string, payload: unknown) {
  return (
    subscription.event === event &&
    Object.entries(subscription.match ?? {}).every(
      ([key, value]) =>
        payload !== null &&
        typeof payload === "object" &&
        Object.hasOwn(payload, key) &&
        (payload as Record<string, unknown>)[key] === value,
    )
  );
}

export function eventPath(subscriptions: readonly EventSubscription[]) {
  return "/events?" + new URLSearchParams({ subscriptions: JSON.stringify(subscriptions) });
}
