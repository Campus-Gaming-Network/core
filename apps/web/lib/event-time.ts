export type ZonedDateTimeResult =
  | { success: true; instant: string }
  | {
      success: false;
      reason:
        | "invalid_datetime"
        | "invalid_timezone"
        | "nonexistent"
        | "ambiguous";
    };

export const eventTimeZones = [
  { id: "America/New_York", label: "Eastern Time" },
  { id: "America/Chicago", label: "Central Time" },
  { id: "America/Denver", label: "Mountain Time" },
  { id: "America/Phoenix", label: "Arizona Time" },
  { id: "America/Los_Angeles", label: "Pacific Time" },
  { id: "America/Anchorage", label: "Alaska Time" },
  { id: "Pacific/Honolulu", label: "Hawaii Time" },
  { id: "America/Puerto_Rico", label: "Atlantic Time" }
] as const;

type LocalDateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

export function localDateTimeToInstant(
  value: string,
  timeZone: string
): ZonedDateTimeResult {
  const local = parseLocalDateTime(value);
  if (!local) {
    return { success: false, reason: "invalid_datetime" };
  }

  const formatter = timeZoneFormatter(timeZone);
  if (!formatter) {
    return { success: false, reason: "invalid_timezone" };
  }

  const localAsUTC = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second
  );
  const candidates: number[] = [];

  // Modern IANA offsets are bounded by UTC-12 through UTC+14 and use
  // 15-minute increments. Checking each possible offset also detects both
  // sides of a fall-back transition without relying on the server's own zone.
  for (
    let offsetMinutes = -14 * 60;
    offsetMinutes <= 14 * 60;
    offsetMinutes += 15
  ) {
    const candidate = localAsUTC - offsetMinutes * 60_000;
    if (sameLocalDateTime(partsInTimeZone(candidate, formatter), local)) {
      candidates.push(candidate);
    }
  }

  if (candidates.length === 0) {
    return { success: false, reason: "nonexistent" };
  }
  if (candidates.length > 1) {
    return { success: false, reason: "ambiguous" };
  }
  return { success: true, instant: new Date(candidates[0]).toISOString() };
}

export function instantToLocalDateTime(value: string, timeZone: string) {
  const instant = Date.parse(value);
  const formatter = timeZoneFormatter(timeZone);
  if (!Number.isFinite(instant) || !formatter) {
    return "";
  }

  const parts = partsInTimeZone(instant, formatter);
  return `${pad(parts.year, 4)}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

export function eventTimeZoneLabel(timeZone: string) {
  return (
    eventTimeZones.find((option) => option.id === timeZone)?.label ?? timeZone
  );
}

function parseLocalDateTime(value: string): LocalDateTimeParts | null {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!match) {
    return null;
  }

  const parts = {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: Number(match[4]),
    minute: Number(match[5]),
    second: Number(match[6] ?? "0")
  };
  const check = new Date(
    Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    )
  );
  if (
    parts.year < 100 ||
    check.getUTCFullYear() !== parts.year ||
    check.getUTCMonth() !== parts.month - 1 ||
    check.getUTCDate() !== parts.day ||
    check.getUTCHours() !== parts.hour ||
    check.getUTCMinutes() !== parts.minute ||
    check.getUTCSeconds() !== parts.second
  ) {
    return null;
  }
  return parts;
}

function timeZoneFormatter(timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    });
  } catch {
    return null;
  }
}

function partsInTimeZone(
  instant: number,
  formatter: Intl.DateTimeFormat
): LocalDateTimeParts {
  const values = new Map(
    formatter
      .formatToParts(new Date(instant))
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, Number(part.value)])
  );
  return {
    year: values.get("year") ?? 0,
    month: values.get("month") ?? 0,
    day: values.get("day") ?? 0,
    hour: values.get("hour") ?? 0,
    minute: values.get("minute") ?? 0,
    second: values.get("second") ?? 0
  };
}

function sameLocalDateTime(
  left: LocalDateTimeParts,
  right: LocalDateTimeParts
) {
  return (
    left.year === right.year &&
    left.month === right.month &&
    left.day === right.day &&
    left.hour === right.hour &&
    left.minute === right.minute &&
    left.second === right.second
  );
}

function pad(value: number, width = 2) {
  return String(value).padStart(width, "0");
}
