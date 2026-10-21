import * as z from "zod";

const countSchema = z.number().int().nonnegative();

export const metricsSchema = z.object({
  as_of: z.iso.date(),
  active: z.object({
    day: countSchema,
    week: countSchema,
    month: countSchema,
  }),
  days: z.array(
    z.object({
      day: z.iso.date(),
      active: countSchema,
      signups: countSchema,
    }),
  ),
  schools: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      active: countSchema,
    }),
  ),
});

export type Metrics = z.output<typeof metricsSchema>;

/** DAU/MAU as a whole percentage, or a dash when nobody was active. */
export function stickiness(active: Metrics["active"]): string {
  return active.month
    ? `${Math.round((active.day / active.month) * 100)}%`
    : "—";
}
