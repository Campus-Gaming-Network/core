"use client";

import { useActionState } from "react";
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
        <p className={`notice ${state.status}`} aria-live="polite">
          {state.message}
        </p>
      ) : null}

      <label>
        Team password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          minLength={8}
          required
        />
      </label>
      <p className="form-help">
        Team pages are public. The password is only checked when you join or
        interact as a member.
      </p>

      <button className="primary" type="submit" disabled={pending}>
        {pending ? "Joining..." : "Join team"}
      </button>
    </form>
  );
}
