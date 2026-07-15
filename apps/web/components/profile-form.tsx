"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Fieldset } from "@heroui/react/fieldset";
import { Input } from "@heroui/react/input";
import { TextArea } from "@heroui/react/textarea";
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
        <Alert
          className={`notice ${state.status}`}
          status={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </Alert>
      ) : null}
      <label>
        Name
        <Input
          name="name"
          defaultValue={profile.name}
          required
          maxLength={120}
        />
      </label>
      <label>
        Bio
        <TextArea
          name="bio"
          defaultValue={profile.bio ?? ""}
          maxLength={2000}
          rows={5}
        />
      </label>
      <label>
        Time zone
        <Input name="timezone" defaultValue={profile.timezone} required />
      </label>
      <Fieldset>
        <Fieldset.Legend>Social links</Fieldset.Legend>
        {[0, 1, 2].map((index) => (
          <div className="split-fields" key={index}>
            <label>
              Label
              <Input
                name={`social_label_${index}`}
                defaultValue={socialLinks[index]?.label ?? ""}
                maxLength={40}
              />
            </label>
            <label>
              URL
              <Input
                name={`social_url_${index}`}
                defaultValue={socialLinks[index]?.url ?? ""}
                type="url"
                maxLength={500}
              />
            </label>
          </div>
        ))}
      </Fieldset>
      <Button type="submit" isDisabled={pending}>
        {pending ? "Saving..." : "Save profile"}
      </Button>
    </form>
  );
}
