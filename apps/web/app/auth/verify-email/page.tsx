import { Alert } from "@heroui/react/alert";
import {
  ResendVerificationForm,
  VerifyEmailForm
} from "../../../components/auth-forms";
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

  return (
    <main className="auth-page">
      <section className="page-heading">
        <p className="eyebrow">Email verification</p>
        <h1>
          {token ? "Confirm your email." : "We could not verify that link."}
        </h1>
      </section>
      {token ? (
        <>
          <p className="lede">
            Select Verify email to finish confirming your address.
          </p>
          <VerifyEmailForm token={token} />
        </>
      ) : (
        <>
          <Alert status="danger">
            This verification link is missing its token.
          </Alert>
          <ResendVerificationForm />
        </>
      )}
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
