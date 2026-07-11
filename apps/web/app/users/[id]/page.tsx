import Link from "next/link";
import { notFound } from "next/navigation";
import { ApiError, publicProfileHomeSchool } from "../../../lib/cgn-api";
import { getPublicProfile } from "../../../lib/server-api";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function PublicProfilePage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getPublicProfile(id).catch((error) => {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }

    throw error;
  });
  const homeSchool = publicProfileHomeSchool(profile);

  return (
    <main className="narrow">
      <section className="profile-hero">
        <div className="avatar" aria-hidden="true">
          {initials(profile.name)}
        </div>
        <div>
          <p className="eyebrow">Public profile</p>
          <h1>{profile.name}</h1>
          <p className="lede">
            {profile.bio || "This profile is ready for campus gaming activity."}
          </p>
        </div>
      </section>

      <section className="detail-grid" aria-label="Profile details">
        <div className="detail-row">
          <span>Verification</span>
          <strong>{profile.verification_level}</strong>
        </div>
        <div className="detail-row">
          <span>Home school</span>
          <strong className="detail-value">
            {homeSchool.href ? (
              <Link href={homeSchool.href}>{homeSchool.name}</Link>
            ) : (
              homeSchool.name
            )}
            {homeSchool.location ? <small>{homeSchool.location}</small> : null}
          </strong>
        </div>
      </section>

      {profile.social_links && profile.social_links.length > 0 ? (
        <section className="section" aria-labelledby="social-links">
          <h2 id="social-links">Links</h2>
          <div className="pill-list">
            {profile.social_links.map((link) => (
              <a href={link.url} key={`${link.label}-${link.url}`}>
                {link.label}
              </a>
            ))}
          </div>
        </section>
      ) : (
        <p className="empty-state">No public links yet.</p>
      )}
    </main>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
