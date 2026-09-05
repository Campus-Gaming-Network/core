"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Input } from "@heroui/react/input";
import { useActionState } from "react";
import { FieldError, fieldErrorProps } from "./form-field-error";
import { joinTeamAction } from "../app/actions";
import { initialFormState } from "../lib/form-state";

type TeamJoinFormProps = {
  slug: string;
};

export function TeamJoinForm({ slug }: TeamJoinFormProps) {
  const [state, action, pending] = useActionState(
    joinTeamAction,
    initialFormState
  );

  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="slug" value={slug} />
      {state.message ? (
        <Alert
          aria-live="polite"
      status={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </Alert>
      ) : null}

      <label>
        Team password
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
          {...fieldErrorProps(state, "password")}
        />
        <FieldError name="password" state={state} />
      </label>
      <p className="form-help">
        Team pages are public. The password is only checked when you join or
        interact as a member.
      </p>

      <Button type="submit" isDisabled={pending}>
        {pending ? "Joining..." : "Join team"}
      </Button>
    </form>
  );
}
