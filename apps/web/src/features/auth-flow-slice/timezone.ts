/**
 * The name a person would say for an IANA time zone, such as "Eastern Time"
 * for America/New_York. Generic names do not change with daylight saving time,
 * so the text stays true all year. Returns undefined for a value that is not a
 * time zone.
 */
export function describeTimeZone(zone: string): string | undefined {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone.trim(),
      timeZoneName: "longGeneric",
    }).formatToParts(0);
    return parts.find((part) => part.type === "timeZoneName")?.value;
  } catch {
    return undefined;
  }
}

export function detectTimeZone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && describeTimeZone(zone) ? zone : undefined;
  } catch {
    return undefined;
  }
}
