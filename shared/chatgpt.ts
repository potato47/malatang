import { z } from "@semicoder/fia/api";
export const CHATGPT_USAGE_URL = "https://chatgpt.com/settings/usage";
export const chatGPTModel = z.strictObject({ id: z.string(), name: z.string() });
export const chatGPTLabel = z.string().trim().min(1, "请输入账号名称").max(100, "账号名称最多 100 个字符").refine(value => !/[\u0000-\u001f\u007f]/.test(value), "账号名称不能包含控制字符");
export const chatGPTStatus = z.strictObject({
  available: z.boolean(), activeProfileId: z.string().nullable(),
  profiles: z.array(z.strictObject({ id: z.string(), label: z.string(), email: z.string().nullable(), connected: z.boolean(), sharing: z.boolean(), welcomeSeen: z.boolean(), incomplete: z.boolean(), removalBlockedReason: z.string().nullable() })),
  attempt: z.strictObject({ id: z.string(), profileId: z.string().nullable(), stage: z.enum(["waiting", "exchanging", "completed", "failed", "cancelled"]), message: z.string() }).nullable(),
  message: z.string(),
});
export type ChatGPTStatus = z.infer<typeof chatGPTStatus>;
export type ChatGPTModel = z.infer<typeof chatGPTModel>;

/** Choose a login target without promoting an unverified registration to an active account.
 * Profiles are stored in creation order; after restart, resume the latest saved registration.
 */
export function chatGPTLoginProfile(status: ChatGPTStatus | null) {
  return status?.profiles.find(p => p.id === status.activeProfileId)
    ?? status?.profiles.find(p => p.id === status.attempt?.profileId)
    ?? status?.profiles.at(-1);
}
