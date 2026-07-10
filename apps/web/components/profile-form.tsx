"use client";

import { useActionState } from "react";
import { updateProfileAction } from "../app/actions";
import { type Profile } from "../lib/cgn-api";
import { initialFormState } from "../lib/form-state";

export function ProfileForm({ profile }: { profile: Profile }) {
  const [state, action, pending] = useActionState(
    updateProfileAction,
    initialFormState
  );
  const socialLinks = profile.social_links ?? [];

  return (
    <form action={action} className="form-stack">
      {state.message ? (
        <p className={`notice ${state.status}`}>{state.message}</p>
      ) : null}
      <label>
        Name
        <input
          name="name"
          defaultValue={profile.name}
          required
          maxLength={120}
        />
      </label>
      <label>
        Bio
        <textarea
          name="bio"
          defaultValue={profile.bio ?? ""}
          maxLength={2000}
          rows={5}
        />
      </label>
      <label>
        Time zone
        <input name="timezone" defaultValue={profile.timezone} required />
      </label>
      <fieldset>
        <legend>Social links</legend>
        {[0, 1, 2].map((index) => (
          <div className="split-fields" key={index}>
            <label>
              Label
              <input
                name={`social_label_${index}`}
                defaultValue={socialLinks[index]?.label ?? ""}
                maxLength={40}
              />
            </label>
            <label>
              URL
              <input
                name={`social_url_${index}`}
                defaultValue={socialLinks[index]?.url ?? ""}
                type="url"
                maxLength={500}
              />
            </label>
          </div>
        ))}
      </fieldset>
      <button type="submit" disabled={pending}>
        {pending ? "Saving..." : "Save profile"}
      </button>
    </form>
  );
}
