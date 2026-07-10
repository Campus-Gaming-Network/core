import Link from "next/link";
import { ResetPasswordForm } from "../../components/auth-forms";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ResetPasswordPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const token = param(params.token);

  return (
    <main className="auth-page">
      <section className="page-heading">
        <p className="eyebrow">Password reset</p>
        <h1>Choose a new password.</h1>
      </section>
      {token ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p className="notice error">
          This reset link is missing its token. Request a new link from{" "}
          <Link href="/forgot-password">forgot password</Link>.
        </p>
      )}
    </main>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
