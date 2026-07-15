"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { TextArea } from "@heroui/react/textarea";
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
        <Alert
          aria-live="polite"
      status={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </Alert>
      ) : null}
      <label>
        Reason
        <TextArea
          name="reason"
          required
          maxLength={2000}
          rows={4}
          placeholder="Tell us what looks unsafe, abusive, spammy, or misleading."
        />
      </label>
      <Button variant="secondary" type="submit" isDisabled={pending}>
        {pending ? "Submitting..." : "Submit report"}
      </Button>
    </form>
  );
}
