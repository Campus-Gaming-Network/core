import { useRouter } from "@tanstack/react-router";
import { useState } from "react";
import type {
  AuthMutationResult,
  FormFieldErrors
} from "./contracts";

const emptyErrors: FormFieldErrors = {};

export function useAuthMutation(fallbackMessage: string) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{
    status: "idle" | "success" | "error";
    message: string;
    fieldErrors: FormFieldErrors;
  }>({ status: "idle", message: "", fieldErrors: emptyErrors });

  async function execute(request: () => Promise<AuthMutationResult>) {
    setPending(true);
    setResult({ status: "idle", message: "", fieldErrors: emptyErrors });
    try {
      const next = await request();
      if (next.status === "error") {
        setResult({
          status: "error",
          message: next.message,
          fieldErrors: next.fieldErrors ?? emptyErrors
        });
      } else if (next.redirectTo) {
        await router.invalidate();
        await router.navigate({ href: next.redirectTo, replace: true });
      } else {
        setResult({
          status: "success",
          message: next.message,
          fieldErrors: emptyErrors
        });
      }
    } catch {
      setResult({
        status: "error",
        message: fallbackMessage,
        fieldErrors: emptyErrors
      });
    } finally {
      setPending(false);
    }
  }

  return { ...result, execute, pending };
}
