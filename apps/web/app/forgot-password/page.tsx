import Link from "next/link";
import { ForgotPasswordForm } from "../../components/auth-forms";

export default function ForgotPasswordPage() {
  return (
    <main className="auth-page">
      <section className="page-heading">
        <p className="eyebrow">Password reset</p>
        <h1>Get a reset link.</h1>
        <p className="lede">
          Enter your email and we will send a reset link if the account exists.
        </p>
      </section>
      <ForgotPasswordForm />
      <p className="form-footer">
        Remembered it? <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
