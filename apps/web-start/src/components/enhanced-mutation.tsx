import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type { FormFieldErrors } from "../features/event-slice/contracts";

type EnhancedMutationResult =
  | { status: "success"; redirectTo: string }
  | {
      status: "error";
      message: string;
      fieldErrors?: FormFieldErrors;
    };

type MutationFeedback = {
  message: string;
  fieldErrors: FormFieldErrors;
};

const emptyFeedback: MutationFeedback = {
  message: "",
  fieldErrors: {}
};

export function useEnhancedMutation(fallbackMessage: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<MutationFeedback>(emptyFeedback);

  async function execute(request: () => Promise<EnhancedMutationResult>) {
    setPending(true);
    setFeedback(emptyFeedback);

    try {
      const result = await request();
      if (result.status === "error") {
        setFeedback({
          message: result.message,
          fieldErrors: result.fieldErrors ?? {}
        });
        return;
      }

      await router.invalidate();
      await router.navigate({ href: result.redirectTo, replace: true });
    } catch {
      setFeedback({ message: fallbackMessage, fieldErrors: {} });
    } finally {
      setPending(false);
    }
  }

  return {
    execute,
    fieldErrors: feedback.fieldErrors,
    message: feedback.message,
    pending
  };
}

export function FieldError({
  id,
  messages
}: {
  id: string;
  messages?: string[];
}) {
  if (!messages || messages.length === 0) {
    return null;
  }

  return (
    <p className="form-error" id={id}>
      {messages.join(" ")}
    </p>
  );
}

export function fieldErrorProps(messages: string[] | undefined, id: string) {
  const invalid = Boolean(messages?.length);

  return {
    "aria-describedby": invalid ? id : undefined,
    "aria-invalid": invalid || undefined
  };
}
