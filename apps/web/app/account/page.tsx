import Link from "next/link";
import { redirect } from "next/navigation";
import { ProfileForm } from "../../components/profile-form";
import { schoolLocation } from "../../lib/cgn-api";
import { currentProfile, listFollowedSchools } from "../../lib/server-api";

export default async function AccountPage() {
  const profile = await currentProfile();

  if (!profile) {
    redirect("/login?next=/account");
  }
  const followedSchools = await listFollowedSchools().catch(() => []);

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

      <section className="section" aria-labelledby="followed-schools-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Following</p>
            <h2 id="followed-schools-title">Followed schools</h2>
          </div>
          <Link href="/schools">Find schools</Link>
        </div>
        {followedSchools.length > 0 ? (
          <div className="list">
            {followedSchools.map((school) => (
              <Link
                className="list-item"
                href={`/schools/${school.slug}`}
                key={school.id}
              >
                <span>
                  <strong>{school.name}</strong>
                  <small>{schoolLocation(school)}</small>
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <p className="empty-state">
            You are not following any additional schools yet.
          </p>
        )}
      </section>

      <ProfileForm profile={profile} />
    </main>
  );
}
