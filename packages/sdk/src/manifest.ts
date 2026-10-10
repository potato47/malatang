import { z } from "zod";
export const manifestSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,63}$/)
    .refine((value) => !["models", "plugins", "settings"].includes(value), "宿主保留名称"),
  name: z.string().trim().min(1).max(60),
  description: z.string().max(240),
  icon: z.string().min(1).max(4),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  sdkVersion: z.literal("0.3"),
  frontend: z.literal("dist/client.js"),
  backend: z.literal("dist/backend.js").optional(),
  styles: z.literal("dist/client.css"),
  keepAlive: z.boolean().default(false),
});
