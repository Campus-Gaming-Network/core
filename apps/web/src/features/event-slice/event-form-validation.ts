/**
 * Browser-side checks for the event form. Each one mirrors a rule in
 * `validateEventForm` (contracts.ts) so an obvious mistake is caught before
 * the round trip. The server stays the authority: these only run with
 * JavaScript and never replace its validation.
 */

const localDateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/;

/** Shown when the end is not after the start. Same wording as the server. */
export const endBeforeStartMessage = "End time must be after start time.";

/**
 * Local date-times in one zone compare as text, so no zone math is needed.
 * Incomplete values return null: the native `required` check covers them.
 */
export function validateEventEnd(
  startsAt: string,
  endsAt: string,
): string | null {
  if (!localDateTimePattern.test(startsAt)) return null;
  if (!localDateTimePattern.test(endsAt)) return null;
  return endsAt.slice(0, 16) <= startsAt.slice(0, 16)
    ? endBeforeStartMessage
    : null;
}

export function suggestEventEnd(startsAt: string): string {
  const match = localDateTimePattern.exec(startsAt);
  if (!match) return "";
  const [, year, month, day, hour, minute] = match.map(Number);
  const end = new Date(
    Date.UTC(year, month - 1, day, hour + 2, minute),
  ).toISOString();
  return end.slice(0, 16);
}

type RecurrenceInput = {
  rule: string;
  until: string;
  startsAt: string;
  endsAt: string;
};

type RecurrenceMessages = {
  recurrence_rule?: string;
  recurrence_until?: string;
};

export function recurrenceUntilBounds(
  startsAt: string,
  endsAt: string,
): { min: string; max: string } {
  const start = /^(\d{4})-(\d{2})-(\d{2})/.exec(startsAt);
  const max = start
    ? new Date(
        Date.UTC(Number(start[1]) + 1, Number(start[2]) - 1, Number(start[3])),
      )
        .toISOString()
        .slice(0, 10)
    : "";
  return {
    min: localDateTimePattern.test(endsAt) ? endsAt.slice(0, 10) : "",
    max,
  };
}

/**
 * The repeat rules of the server: a rule needs an end date and the reverse,
 * the end date cannot precede the first event, and a series runs at most one
 * year from its start.
 */
export function validateRecurrence({
  rule,
  until,
  startsAt,
  endsAt,
}: RecurrenceInput): RecurrenceMessages {
  if (!rule && until) {
    return { recurrence_rule: "Choose a repeat interval for this end date." };
  }
  if (rule && !until) {
    return { recurrence_until: "Choose when the recurrence ends." };
  }
  if (!rule || !until) return {};
  const { min, max } = recurrenceUntilBounds(startsAt, endsAt);
  if (min && until < min) {
    return { recurrence_until: "Recurrence must end after the first event." };
  }
  if (max && until > max) {
    return { recurrence_until: "Recurrence cannot extend more than one year." };
  }
  return {};
}

/**
 * The private-password rules. The server trims the value before it counts.
 * On edit a blank password keeps the current one.
 */
export function validatePrivatePassword({
  visibility,
  password,
  mode,
}: {
  visibility: string;
  password: string;
  mode: "create" | "edit";
}): string | null {
  const length = password.trim().length;
  if (visibility !== "private") {
    return length > 0
      ? "Only private events use a password. Clear it or choose Private."
      : null;
  }
  if (mode === "create" && length < 8) {
    return "Private events require a password of at least 8 characters.";
  }
  if (mode === "edit" && length > 0 && length < 8) {
    return "A new private-event password must be at least 8 characters.";
  }
  return null;
}
