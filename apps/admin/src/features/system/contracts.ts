import * as z from "zod";

// What each dependency the Admin API probes is used for.
export const systemCheckLabels = {
  object_storage: "School logo storage",
  igdb: "IGDB game data",
} as const;

export const systemStatusLabels = {
  ok: "Answering",
  unreachable: "Not answering",
  not_configured: "Not configured",
} as const;

const countSchema = z.number().int().nonnegative();

export const systemSchema = z.object({
  checks: z.array(
    z.object({
      name: z.enum(
        Object.keys(systemCheckLabels) as (keyof typeof systemCheckLabels)[],
      ),
      status: z.enum(
        Object.keys(systemStatusLabels) as (keyof typeof systemStatusLabels)[],
      ),
    }),
  ),
  email_outbox: z.object({
    pending: countSchema,
    retrying: countSchema,
    failed: countSchema,
    oldest_pending_at: z.iso.datetime({ offset: true }).nullable(),
  }),
});

export type SystemStatus = z.output<typeof systemSchema>;
