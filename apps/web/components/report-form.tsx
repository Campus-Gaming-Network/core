"use client";

import { useActionState } from "react";
import {
  reportEventAction,
  reportUserAction
} from "../app/actions";
import { initialFormState } from "../lib/form-state";

type ReportFormProps = {
  targetID: string;
  targetType: "event" | "user";
};

export function ReportForm({ targetID, targetType }: ReportFormProps) {
  const [state, action, pending] = useActionState(
    targetType === "event" ? reportEventAction : reportUserAction,
    initialFormState
  );

  return (
    <form action={action} className="form-stack">
      <input
        type="hidden"
        name={targetType === "event" ? "slug" : "user_id"}
        value={targetID}
      />
      {state.message ? (
        <p className={`notice ${state.status}`} aria-live="polite">
          {state.message}
        </p>
      ) : null}
      <label>
        Reason
        <textarea
          name="reason"
          required
          maxLength={2000}
          rows={4}
          placeholder="Tell us what looks unsafe, abusive, spammy, or misleading."
        />
      </label>
      <button className="secondary" type="submit" disabled={pending}>
        {pending ? "Submitting..." : "Submit report"}
      </button>
    </form>
  );
}
