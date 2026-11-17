import { useHydrated } from "@tanstack/react-router";
import { useState } from "react";
import {
  FieldError,
  fieldErrorProps,
} from "../../components/enhanced-mutation.js";
import { FormField } from "../../components/form-field";
import { FormSection } from "../../components/form-section";
import type { EventDTO } from "./contracts.js";
import type { EventFieldErrors } from "./event-form.js";

type Props = {
  event?: EventDTO;
  errors: EventFieldErrors;
};

const costOptions = [
  {
    value: "unspecified",
    label: "Not specified",
    hint: "Say nothing about cost",
  },
  { value: "free", label: "Free", hint: "No charge to attend" },
  { value: "paid", label: "Paid", hint: "Payment happens off CGN" },
] as const;

export function EventCostFields({ event, errors }: Props) {
  const hydrated = useHydrated();
  const [cost, setCost] = useState<string>(event?.cost ?? "unspecified");

  return (
    <FormSection
      id="event-cost"
      title="Cost"
      description="Say whether the event is free. Payment happens outside CGN; the note and link apply to paid events."
    >
      <fieldset className="choice-group">
        <legend>Cost</legend>
        <div className="choice-cards">
          {costOptions.map((option) => (
            <label className="choice-card" key={option.value}>
              <input
                defaultChecked={(event?.cost ?? "unspecified") === option.value}
                name="cost"
                onChange={(change) => setCost(change.currentTarget.value)}
                required
                type="radio"
                value={option.value}
                {...fieldErrorProps(errors("cost"), "event-cost-error")}
              />
              <span className="choice-card-title">{option.label}</span>
              <span className="choice-card-hint">{option.hint}</span>
            </label>
          ))}
        </div>
        <FieldError id="event-cost-error" messages={errors("cost")} />
      </fieldset>
      {/* Hidden only once the page is interactive, so a native submission
        still carries the values; a free event keeps what was typed. */}
      <div
        className="event-payment-fields"
        hidden={hydrated && cost !== "paid"}
      >
        <FormField
          errorId="event-payment-note-error"
          errors={errors("payment_note")}
          label="Payment note"
          optional
          characterCount
        >
          <textarea
            defaultValue={event?.payment_note ?? ""}
            maxLength={1000}
            name="payment_note"
            placeholder="Tell attendees how payment works outside CGN."
            rows={3}
          />
        </FormField>
        <FormField
          errorId="event-payment-url-error"
          errors={errors("payment_url")}
          label="Payment URL"
          optional
        >
          <input
            defaultValue={event?.payment_url ?? ""}
            autoCapitalize="none"
            autoComplete="off"
            inputMode="url"
            maxLength={500}
            name="payment_url"
            placeholder="https://..."
            spellCheck={false}
            type="url"
          />
        </FormField>
      </div>
    </FormSection>
  );
}
