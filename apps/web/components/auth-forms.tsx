"use client";

import { useActionState } from "react";
import {
  forgotPasswordAction,
  loginAction,
  resendVerificationAction,
  resetPasswordAction,
  signupAction
} from "../app/actions";
import { schoolLocation, type School } from "../lib/cgn-api";
import { initialFormState } from "../lib/form-state";

type SignupFormProps = {
  schools: School[];
  selectedSchoolId?: string;
};

export function SignupForm({ schools, selectedSchoolId }: SignupFormProps) {
  const [state, action, pending] = useActionState(
    signupAction,
    initialFormState
  );

  return (
    <form action={action} className="form-stack">
      <FormNotice state={state} />
      <label>
        Name
        <input name="name" autoComplete="name" required maxLength={120} />
      </label>
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>
      <label>
        Time zone
        <input
          name="timezone"
          defaultValue="America/Los_Angeles"
          autoComplete="off"
          required
        />
      </label>
      <label>
        Home school
        <select name="home_school_id" defaultValue={selectedSchoolId} required>
          <option value="">Choose a school</option>
          {schools.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}
              {school.city || school.state
                ? ` (${schoolLocation(school, "")})`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="check-row">
        <input name="age_confirmed" type="checkbox" required />
        <span>I confirm I am 18 or older.</span>
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Creating account..." : "Create account"}
      </button>
    </form>
  );
}

export function LoginForm({
  next,
  notice
}: {
  next?: string;
  notice?: string;
}) {
  const [state, action, pending] = useActionState(
    loginAction,
    initialFormState
  );

  return (
    <form action={action} className="form-stack">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      {notice ? <p className="notice success">{notice}</p> : null}
      <FormNotice state={state} />
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <label>
        Password
        <input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Logging in..." : "Log in"}
      </button>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(
    forgotPasswordAction,
    initialFormState
  );

  return (
    <form action={action} className="form-stack">
      <FormNotice state={state} />
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send reset link"}
      </button>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    resetPasswordAction,
    initialFormState
  );

  return (
    <form action={action} className="form-stack">
      <input type="hidden" name="token" value={token} />
      <FormNotice state={state} />
      <label>
        New password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Resetting..." : "Reset password"}
      </button>
    </form>
  );
}

export function ResendVerificationForm() {
  const [state, action, pending] = useActionState(
    resendVerificationAction,
    initialFormState
  );

  return (
    <form action={action} className="inline-form">
      <FormNotice state={state} />
      <label>
        Email
        <input name="email" type="email" autoComplete="email" required />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Resend verification"}
      </button>
    </form>
  );
}

function FormNotice({
  state
}: {
  state: {
    status: "idle" | "success" | "error";
    message: string;
  };
}) {
  if (!state.message) {
    return null;
  }

  return <p className={`notice ${state.status}`}>{state.message}</p>;
}
