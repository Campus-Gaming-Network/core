import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent } from "react";
import { confirmEmailChange } from "./account.functions";

/** The Confirm email button on the page a new address's link opens. */
export function ConfirmEmailChangeForm({ token }: { token: string }) {
  const runConfirm = useServerFn(confirmEmailChange);
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");
    try {
      const result = await runConfirm({
        data: new FormData(event.currentTarget),
      });
      if (result.status === "success") {
        // The same page a post without JavaScript lands on, with the token
        // gone from the address bar.
        await router.navigate({
          to: "/confirm-email-change",
          search: { changed: "complete" },
          replace: true,
        });
        return;
      }
      setError(result.message);
    } catch {
      setError("We could not change your email. Please try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      action={confirmEmailChange.url}
      className="form-stack"
      method="post"
      onSubmit={submit}
    >
      <input name="token" type="hidden" value={token} />
      {error ? <p role="alert">{error}</p> : null}
      <button disabled={pending} type="submit">
        {pending ? "Confirming…" : "Confirm email"}
      </button>
    </form>
  );
}
