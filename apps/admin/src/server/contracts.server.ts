import * as z from "zod";

const capabilitySchema = z.enum([
  "admin.session.read",
  "reports.read",
  "reports.manage",
  "support.read",
  "support.manage",
  "schools.read",
  "schools.manage",
  "school_logos.manage",
  "games.manage",
  "users.read",
  "users.manage_status",
  "school_grants.manage",
  "trust_grants.manage",
  "site_grants.manage",
  "audit.read",
]);

export const adminSessionSchema = z.object({
  user_id: z.string().uuid(),
  email: z.email(),
  role: z.literal("site_admin"),
  capabilities: z.array(capabilitySchema),
  authenticated_at: z.iso.datetime({ offset: true }),
  step_up_at: z.iso.datetime({ offset: true }).optional(),
  absolute_expires_at: z.iso.datetime({ offset: true }),
});

export type AdminSession = z.output<typeof adminSessionSchema>;
