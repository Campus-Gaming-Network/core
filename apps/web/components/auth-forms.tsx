"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Input } from "@heroui/react/input";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import Link from "next/link";
import { useActionState } from "react";
import { FieldError, fieldErrorProps } from "./form-field-error";
import {
  forgotPasswordAction,
  loginAction,
  resendVerificationAction,
  resetPasswordAction,
  signupAction,
  verifyEmailAction
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
        <Input
          name="name"
          autoComplete="name"
          required
          maxLength={120}
          {...fieldErrorProps(state, "name")}
        />
        <FieldError name="name" state={state} />
      </label>
      <label>
        Email
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          {...fieldErrorProps(state, "email")}
        />
        <FieldError name="email" state={state} />
      </label>
      <label>
        Password
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          {...fieldErrorProps(state, "password")}
        />
        <FieldError name="password" state={state} />
      </label>
      <label>
        Time zone
        <Input
          name="timezone"
          defaultValue="America/Los_Angeles"
          autoComplete="off"
          required
          {...fieldErrorProps(state, "timezone")}
        />
        <FieldError name="timezone" state={state} />
      </label>
      <label>
        Home school
        <Select
          fullWidth
          name="home_school_id"
          defaultSelectedKey={selectedSchoolId || ""}
          aria-label="Home school"
          isRequired
          {...fieldErrorProps(state, "home_school_id")}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="" textValue="Choose a school">
                Choose a school
              </ListBox.Item>
              {schools.map((school) => {
                const label = `${school.name}${
                  school.city || school.state
                    ? ` (${schoolLocation(school, "")})`
                    : ""
                }`;

                return (
                  <ListBox.Item id={school.id} key={school.id} textValue={label}>
                    {label}
                  </ListBox.Item>
                );
              })}
            </ListBox>
          </Select.Popover>
        </Select>
        <FieldError name="home_school_id" state={state} />
      </label>
      <label className="checkbox-field">
        <input
          type="checkbox"
          name="age_confirmed"
          required
          {...fieldErrorProps(state, "age_confirmed")}
        />
        <span>I confirm I am 18 or older.</span>
      </label>
      <FieldError name="age_confirmed" state={state} />
      <Button type="submit" isDisabled={pending}>
        {pending ? "Creating account..." : "Create account"}
      </Button>
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
      {notice ? (
        <Alert status="success">
          {notice}
        </Alert>
      ) : null}
      <FormNotice state={state} />
      <label>
        Email
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          {...fieldErrorProps(state, "email")}
        />
        <FieldError name="email" state={state} />
      </label>
      <label>
        Password
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
          {...fieldErrorProps(state, "password")}
        />
        <FieldError name="password" state={state} />
      </label>
      <Button type="submit" isDisabled={pending}>
        {pending ? "Logging in..." : "Log in"}
      </Button>
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
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          {...fieldErrorProps(state, "email")}
        />
        <FieldError name="email" state={state} />
      </label>
      <Button type="submit" isDisabled={pending}>
        {pending ? "Sending..." : "Send reset link"}
      </Button>
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
      <FieldError name="token" state={state} />
      <label>
        New password
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          {...fieldErrorProps(state, "password")}
        />
        <FieldError name="password" state={state} />
      </label>
      <Button type="submit" isDisabled={pending}>
        {pending ? "Resetting..." : "Reset password"}
      </Button>
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
        <Input
          name="email"
          type="email"
          autoComplete="email"
          required
          {...fieldErrorProps(state, "email")}
        />
        <FieldError name="email" state={state} />
      </label>
      <Button type="submit" isDisabled={pending}>
        {pending ? "Sending..." : "Resend verification"}
      </Button>
    </form>
  );
}

export function VerifyEmailForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    verifyEmailAction,
    initialFormState
  );

  if (state.status === "success") {
    return (
      <Alert status="success">
        {state.message}{" "}
        <Link className="link" href="/login">
          Log in
        </Link>{" "}
        to continue.
      </Alert>
    );
  }

  return (
    <>
      <form action={action} className="form-stack">
        <input type="hidden" name="token" value={token} />
        <FormNotice state={state} />
        <FieldError name="token" state={state} />
        <Button type="submit" isDisabled={pending}>
          {pending ? "Verifying..." : "Verify email"}
        </Button>
      </form>
      {state.status === "error" ? (
        <section
          className="form-stack"
          aria-labelledby="resend-heading"
        >
          <h2 id="resend-heading">Need a new link?</h2>
          <ResendVerificationForm />
        </section>
      ) : null}
    </>
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

  return (
    <Alert
      status={state.status === "error" ? "danger" : "success"}
    >
      {state.message}
    </Alert>
  );
}
