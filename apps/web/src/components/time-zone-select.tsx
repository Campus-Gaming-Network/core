import { eventTimeZones } from "../features/event-slice/event-time";

/**
 * A pick list of time zones, so nobody has to know how to spell one. The US
 * zones come first by their everyday names; every other zone follows, grouped
 * by region and named by its city. `zones` is the full list, read once on the
 * server (see `allTimeZones`), so the server and the browser render the same
 * options. A saved value the list lacks is kept as its own option.
 */
export function TimeZoneSelect({
  defaultValue,
  zones,
  ...props
}: {
  defaultValue: string;
  zones: readonly string[];
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
  "aria-labelledby"?: string;
  name: string;
}) {
  const common = new Set<string>(eventTimeZones.map((zone) => zone.id));
  const regions = new Map<string, string[]>();
  for (const zone of zones) {
    if (common.has(zone)) continue;
    const [region, ...place] = zone.split("/");
    if (!region || place.length === 0) continue;
    regions.set(region, [...(regions.get(region) ?? []), zone]);
  }
  const known = common.has(defaultValue) || zones.includes(defaultValue);

  return (
    <select {...props} defaultValue={defaultValue} required>
      {!known && defaultValue ? (
        <option value={defaultValue}>
          {defaultValue.replaceAll("_", " ")}
        </option>
      ) : null}
      <optgroup label="United States">
        {eventTimeZones.map((zone) => (
          <option key={zone.id} value={zone.id}>
            {zone.label} ({zone.id.split("/").pop()?.replaceAll("_", " ")})
          </option>
        ))}
      </optgroup>
      {[...regions].map(([region, regionZones]) => (
        <optgroup key={region} label={region}>
          {regionZones.map((zone) => (
            <option key={zone} value={zone}>
              {zone.split("/").slice(1).join(" / ").replaceAll("_", " ")}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

/** Every IANA zone this runtime knows, for `TimeZoneSelect`. Server side. */
export function allTimeZones(): string[] {
  try {
    return Intl.supportedValuesOf("timeZone");
  } catch {
    return eventTimeZones.map((zone) => zone.id);
  }
}
