import {
  type SocialLink,
  formCheckbox,
  formString
} from "./cgn-api";

export function socialLinksFromForm(formData: FormData) {
  const links: SocialLink[] = [];

  for (let index = 0; index < 3; index += 1) {
    const label = formString(formData, `social_label_${index}`);
    const url = formString(formData, `social_url_${index}`);

    if (label || url) {
      links.push({ label, url });
    }
  }

  return links;
}

export function eventBodyFromForm(formData: FormData) {
  return {
    title: formString(formData, "title"),
    description: formString(formData, "description"),
    host_school_id: formString(formData, "host_school_id"),
    game_ids: formData.getAll("game_ids").filter(isString).map((value) => value.trim()),
    visibility: formString(formData, "visibility"),
    format: formString(formData, "format"),
    starts_at: formString(formData, "starts_at"),
    ends_at: formString(formData, "ends_at"),
    timezone: formString(formData, "timezone") || "America/Los_Angeles",
    location_name: formString(formData, "location_name"),
    address: formString(formData, "address"),
    online_url: formString(formData, "online_url"),
    private_password: formString(formData, "private_password"),
    capacity: capacityFromForm(formData),
    is_paid: formCheckbox(formData, "is_paid"),
    payment_note: formString(formData, "payment_note"),
    payment_url: formString(formData, "payment_url"),
    recurrence_rule: formString(formData, "recurrence_rule"),
    recurrence_until: formString(formData, "recurrence_until") || undefined
  };
}

export function teamBodyFromForm(formData: FormData) {
  return {
    name: formString(formData, "name"),
    description: formString(formData, "description"),
    school_id: formString(formData, "school_id"),
    game_ids: formData.getAll("game_ids").filter(isString).map((value) => value.trim()),
    password: formString(formData, "password")
  };
}

export function teamJoinBodyFromForm(formData: FormData) {
  return {
    password: formString(formData, "password")
  };
}

export function privateUnlockBodyFromForm(formData: FormData) {
  return {
    password: formString(formData, "password")
  };
}

export function rsvpBodyFromForm(formData: FormData) {
  return {
    response: formString(formData, "response")
  };
}

function capacityFromForm(formData: FormData) {
  const raw = formString(formData, "capacity");
  if (!raw) {
    return undefined;
  }

  return Number(raw);
}

function isString(value: FormDataEntryValue): value is string {
  return typeof value === "string";
}
