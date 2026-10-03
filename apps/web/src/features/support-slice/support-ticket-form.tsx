import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Callout } from "../../components/callout";
import { FormErrorSummary } from "../../components/enhanced-mutation";
import { FormField } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import { useIdempotencyKey } from "../../components/idempotency-key";
import type { SupportFieldErrors } from "./contracts";
import { submitSupportTicket } from "./support.functions";

const emptyErrors: SupportFieldErrors = {};

export function SupportTicketForm({
  idempotencyKey,
  initialStatus,
}: {
  idempotencyKey: string;
  initialStatus?: "failed" | "submitted";
}) {
  const idempotency = useIdempotencyKey(idempotencyKey);
  const runSubmission = useServerFn(submitSupportTicket);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    status: "idle" | "success" | "error";
    message: string;
    fieldErrors: SupportFieldErrors;
  }>({ status: "idle", message: "", fieldErrors: emptyErrors });

  useEffect(() => {
    if (result.status === "error" && result.message) {
      errorSummaryRef.current?.focus();
    }
  }, [result]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setResult({ status: "idle", message: "", fieldErrors: emptyErrors });
    try {
      const next = await runSubmission({
        data: new FormData(event.currentTarget),
      });
      setResult({
        status: next.status,
        message: next.message,
        fieldErrors:
          next.status === "error"
            ? (next.fieldErrors ?? emptyErrors)
            : emptyErrors,
      });
      if (next.status === "success") idempotency.rotate();
    } catch {
      setResult({
        status: "error",
        message: "We could not submit that support ticket. Please try again.",
        fieldErrors: emptyErrors,
      });
    } finally {
      setPending(false);
    }
  }

  const initialMessage =
    initialStatus === "submitted"
      ? "Support ticket submitted. We will review it soon."
      : initialStatus === "failed"
        ? "We could not submit that support ticket. Please try again."
        : "";
  const status = result.message
    ? result.status
    : initialStatus === "submitted"
      ? "success"
      : initialStatus === "failed"
        ? "error"
        : "idle";

  return (
    <form
      action={submitSupportTicket.url}
      className="form-stack sectioned-form"
      method="post"
      onSubmit={submit}
    >
      <input name="idempotency_key" type="hidden" value={idempotency.key} />
      {status === "error" ? (
        <FormErrorSummary
          fieldErrors={result.fieldErrors}
          fieldIds={{
            contact_email: "contact_email-error",
            name: "name-error",
            subject: "subject-error",
            message: "message-error",
          }}
          message={result.message || initialMessage}
          summaryRef={errorSummaryRef}
        />
      ) : result.message || initialMessage ? (
        <p aria-live="polite" role="status">
          {result.message || initialMessage}
        </p>
      ) : null}

      <FormSection
        title="Contact"
        description="Tell us how to reach you about this request."
      >
        <div className="split-fields">
          <FormField
            errorId="contact_email-error"
            errors={result.fieldErrors.contact_email}
            label="Email"
          >
            <input
              name="contact_email"
              type="email"
              autoComplete="email"
              required
            />
          </FormField>
          <FormField
            errorId="name-error"
            errors={result.fieldErrors.name}
            label="Name"
          >
            <input name="name" autoComplete="name" maxLength={120} />
          </FormField>
        </div>
      </FormSection>
      <FormSection
        title="Request"
        description="Describe what happened and what you need."
      >
        <FormField
          errorId="subject-error"
          errors={result.fieldErrors.subject}
          label="Subject"
        >
          <input name="subject" required maxLength={160} />
        </FormField>
        <FormField
          errorId="message-error"
          errors={result.fieldErrors.message}
          label="Message"
        >
          <textarea name="message" required maxLength={5000} rows={7} />
        </FormField>
        <Callout icon="shield">
          Support tickets are queued for review. Do not include passwords,
          payment card details, or other sensitive secrets.
        </Callout>
      </FormSection>
      <div className="form-actions">
        <button type="submit" disabled={pending}>
          {pending ? "Submitting…" : "Submit support ticket"}
        </button>
      </div>
    </form>
  );
}
