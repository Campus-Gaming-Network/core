"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Fieldset } from "@heroui/react/fieldset";
import { Input } from "@heroui/react/input";
import { TextArea } from "@heroui/react/textarea";
import { useActionState } from "react";
import { FieldError, fieldErrorProps } from "./form-field-error";
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
          {...fieldErrorProps(state, "name")}
        />
        <FieldError name="name" state={state} />
      </label>
      <label>
        Bio
        <TextArea
          name="bio"
          defaultValue={profile.bio ?? ""}
          maxLength={2000}
          rows={5}
          {...fieldErrorProps(state, "bio")}
        />
        <FieldError name="bio" state={state} />
      </label>
      <label>
        Time zone
        <Input
          name="timezone"
          defaultValue={profile.timezone}
          required
          {...fieldErrorProps(state, "timezone")}
        />
        <FieldError name="timezone" state={state} />
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
                {...fieldErrorProps(state, `social_label_${index}`)}
              />
              <FieldError name={`social_label_${index}`} state={state} />
            </label>
            <label>
              URL
              <Input
                name={`social_url_${index}`}
                defaultValue={socialLinks[index]?.url ?? ""}
                type="url"
                maxLength={500}
                {...fieldErrorProps(state, `social_url_${index}`)}
              />
              <FieldError name={`social_url_${index}`} state={state} />
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
