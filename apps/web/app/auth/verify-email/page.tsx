import Link from "next/link";
import { ResendVerificationForm } from "../../../components/auth-forms";
import { verifyEmailToken } from "../../../lib/server-api";

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
        <p className="notice success">
          Your email is verified. <Link href="/login">Log in</Link> to continue.
        </p>
      ) : (
        <>
          <p className="notice error">
            {status === "missing"
              ? "This verification link is missing its token."
              : "This verification link is invalid or expired."}
          </p>
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
