import { useServerFn } from "@tanstack/react-start";
import { CircleCheck } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { Callout } from "../../components/callout";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation";
import { FormField, RequiredFieldsNote } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import { submitClubClaim, submitClubRequest } from "./club.functions";
import { claimFailureMessages, type ClaimOutcome } from "./contracts";
import { clubTypeLabels } from "./presentation";

const fieldIds = {
  name: "club-name-error",
  type: "club-type-error",
  evidence_text: "evidence-text-error",
  evidence_url: "evidence-url-error",
};

/**
 * The form an officer sends to claim a listed club or to request a new one.
 * Both ask for evidence; a school email address alone does not show that
 * someone runs a club.
 */
export function ClubClaimForm({
  target,
  outcome,
  submitLabel,
}: {
  target:
    | { kind: "claim"; slug: string }
    | { kind: "request"; schoolSlug: string };
  outcome?: ClaimOutcome;
  submitLabel: string;
}) {
  const serverFn =
    target.kind === "claim" ? submitClubClaim : submitClubRequest;
  const run = useServerFn(serverFn);
  const mutation = useEnhancedMutation(claimFailureMessages.failed);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutation.execute(() => run({ data }));
  }

  const initialMessage =
    outcome && outcome !== "submitted" ? claimFailureMessages[outcome] : "";

  return (
    <form
      action={serverFn.url}
      className="form-stack sectioned-form"
      method="post"
      onSubmit={submit}
    >
      {target.kind === "claim" ? (
        <input name="slug" type="hidden" value={target.slug} />
      ) : (
        <input name="school_slug" type="hidden" value={target.schoolSlug} />
      )}
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={fieldIds}
        message={mutation.message || initialMessage}
        summaryRef={mutation.errorSummaryRef}
      />
      <RequiredFieldsNote />
      {target.kind === "request" ? (
        <FormSection
          title="The club"
          description="The name and type the club's page will show."
        >
          <FormField
            errorId={fieldIds.name}
            errors={mutation.fieldErrors.name}
            label="Club name"
            characterCount
          >
            <input autoComplete="off" maxLength={120} name="name" required />
          </FormField>
          <FormField
            errorId={fieldIds.type}
            errors={mutation.fieldErrors.type}
            label="Type"
          >
            <select defaultValue="student_club" name="type" required>
              {Object.entries(clubTypeLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </FormField>
        </FormSection>
      ) : null}
      <FormSection
        title="Show that you run it"
        description="A site admin checks this by hand before anything changes."
      >
        <FormField
          errorId={fieldIds.evidence_text}
          errors={mutation.fieldErrors.evidence_text}
          label="How can we confirm you are an officer?"
          characterCount
        >
          <textarea maxLength={2000} name="evidence_text" required rows={6} />
        </FormField>
        <FormField
          errorId={fieldIds.evidence_url}
          errors={mutation.fieldErrors.evidence_url}
          label="Link that lists you or the club"
          optional
        >
          <input
            autoComplete="off"
            inputMode="url"
            maxLength={500}
            name="evidence_url"
            placeholder="https://"
            type="url"
          />
        </FormField>
        <Callout icon="shield">
          Point us to the club on your university&apos;s student organization
          page, or name an official club contact we can reach. A school email
          address alone does not show that you run a club. Only site admins see
          what you write here.
        </Callout>
      </FormSection>
      <div className="form-actions">
        <button type="submit" disabled={mutation.pending}>
          {mutation.pending ? "Sending…" : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** Shown in place of the form once it has been sent. */
export function ClaimSubmitted({ children }: { children: ReactNode }) {
  return (
    <div className="support-success" role="status">
      <CircleCheck aria-hidden="true" size={24} strokeWidth={1.75} />
      <div>
        <strong>Sent for review.</strong>
        <p>{children} A site admin will review it and email you either way.</p>
      </div>
    </div>
  );
}
