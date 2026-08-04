import { Alert } from "@heroui/react/alert";
import Link from "next/link";
import { ResendVerificationForm } from "../../../components/auth-forms";
import { verifyEmailToken } from "../../../lib/server-api";
import { pageMetadata } from "../../../lib/metadata";

export const metadata = pageMetadata({
  title: "Verify email",
  description:
    "Confirm your email address for Campus Gaming Network.",
  path: "/auth/verify-email",
  noIndex: true
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function VerifyEmailPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = param(params.token);
  let status: "missing" | "verified" | "invalid" = "missing";

  if (token) {
    status = "verified";
    await verifyEmailToken(token).catch(() => {
      status = "invalid";
    });
  }

  return (
    <main className="auth-page">
      <section className="page-heading">
        <p className="eyebrow">Email verification</p>
        <h1>{heading(status)}</h1>
      </section>
      {status === "verified" ? (
        <Alert status="success">
          Your email is verified. <Link className="link" href="/login">Log in</Link> to continue.
        </Alert>
      ) : (
        <>
          <Alert status="danger">
            {status === "missing"
              ? "This verification link is missing its token."
              : "This verification link is invalid or expired."}
          </Alert>
          <ResendVerificationForm />
        </>
      )}
    </main>
  );
}

function heading(status: "missing" | "verified" | "invalid") {
  if (status === "verified") {
    return "Email verified.";
  }

  return "We could not verify that link.";
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
