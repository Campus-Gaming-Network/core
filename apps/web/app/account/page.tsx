import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "../../components/profile-form";
import { currentProfile } from "../../lib/server-api";

export default async function AccountPage() {
  const profile = await currentProfile();

  if (!profile) {
    redirect("/login?next=/account");
  }

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Account</p>
        <h1>{profile.name}</h1>
        <p className="lede">
          Maintain the basic profile details shown on your public profile.
        </p>
      </section>

      <section className="summary-strip" aria-label="Account summary">
        <span>
          <strong>Email</strong>
          {profile.email}
        </span>
        <span>
          <strong>Verification</strong>
          {profile.email_verified_at ? "Email verified" : "Email pending"}
        </span>
        <span>
          <strong>Public profile</strong>
          <Link href={`/users/${profile.id}`}>View profile</Link>
        </span>
      </section>

      {!profile.email_verified_at ? (
        <p className="notice error">
          Verify your email to unlock normal authenticated use.
        </p>
      ) : null}

      <ProfileForm profile={profile} />
    </main>
  );
}
