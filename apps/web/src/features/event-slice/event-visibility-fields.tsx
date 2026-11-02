import { useRef, useState } from "react";
import { useCustomValidity } from "../../components/custom-validity.js";
import {
  FieldError,
  fieldErrorProps,
} from "../../components/enhanced-mutation.js";
import { FormField } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import { PasswordInput } from "../../components/password-input";
import type { EventDTO } from "./contracts.js";
import type { EventFieldErrors } from "./event-form.js";
import { validatePrivatePassword } from "./event-form-validation.js";

type Props = {
  mode: "create" | "edit";
  event?: EventDTO;
  attempted: boolean;
  errors: EventFieldErrors;
};

const visibilityOptions = [
  {
    value: "public",
    label: "Public",
    hint: "Listed in search and browse. Anyone can view it.",
  },
  {
    value: "unlisted",
    label: "Unlisted",
    hint: "Not listed. Anyone with the link can view it.",
  },
  {
    value: "private",
    label: "Private",
    hint: "Not listed. Details stay locked until someone enters the password.",
  },
] as const;

export function EventVisibilityFields({
  mode,
  event,
  attempted,
  errors,
}: Props) {
  const [visibility, setVisibility] = useState<string>(
    event?.visibility ?? "public",
  );
  const [password, setPassword] = useState("");
  // A short password is flagged only after a submit attempt or leaving the
  // field.
  const [passwordTouched, setPasswordTouched] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);
  const passwordError = validatePrivatePassword({ visibility, password, mode });
  useCustomValidity(passwordRef, passwordError);

  return (
    <FormSection
      id="event-visibility"
      title="Visibility"
      description="Choose who can find and open the event page."
    >
      <fieldset className="choice-group">
        <legend>Who can see it</legend>
        <div className="choice-cards">
          {visibilityOptions.map((option) => (
            <label className="choice-card" key={option.value}>
              <input
                defaultChecked={
                  (event?.visibility ?? "public") === option.value
                }
                name="visibility"
                onChange={(change) => setVisibility(change.currentTarget.value)}
                required
                type="radio"
                value={option.value}
                {...fieldErrorProps(
                  errors("visibility"),
                  "event-visibility-error",
                )}
              />
              <span className="choice-card-title">{option.label}</span>
              <span className="choice-card-hint">{option.hint}</span>
            </label>
          ))}
        </div>
        <FieldError
          id="event-visibility-error"
          messages={errors("visibility")}
        />
      </fieldset>

      {/* The password stays in the form for every visibility so a native
        submission can always send it. CSS only emphasizes it while
        Private is selected; the server validates the combination. */}
      <div className="event-private-password">
        <FormField
          errorId="event-private-password-error"
          errors={errors(
            "private_password",
            passwordError,
            visibility !== "private" || attempted || passwordTouched,
          )}
          label="Private event password"
        >
          <PasswordInput
            autoComplete="off"
            maxLength={256}
            minLength={8}
            name="private_password"
            onBlur={() => setPasswordTouched(true)}
            onChange={(change) => setPassword(change.currentTarget.value)}
            placeholder={
              mode === "edit"
                ? "Leave blank to keep current password"
                : "Required for private events"
            }
            ref={passwordRef}
            value={password}
          />
        </FormField>
        <p className="form-help">
          {visibility !== "private"
            ? "Only used when visibility is Private."
            : mode === "edit"
              ? "Leave blank to keep the current password, or enter a new one of at least 8 characters."
              : "Required. Use at least 8 characters and share it with the people you invite."}
        </p>
      </div>
    </FormSection>
  );
}
