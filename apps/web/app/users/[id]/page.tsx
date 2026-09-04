import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { EmptyState } from "@heroui/react/empty-state";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReportForm } from "../../../components/report-form";
import { UserAvatar } from "../../../components/user-avatar";
import {
  ApiError,
  publicProfileHomeSchool,
  roleIndicatorLabel,
  verificationLabel
} from "../../../lib/cgn-api";
import { pageMetadata } from "../../../lib/metadata";
import { currentProfile, getPublicProfile } from "../../../lib/server-api";

type PageProps = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({
  params
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  // Match the page body so a missing profile still answers 404 rather than
  // committing a 200 response from metadata generation.
  const profile = await getPublicProfile(id).catch((error) => {
    if (error instanceof ApiError && error.status === 404) {
      notFound();
    }

    throw error;
  });

  const homeSchool = publicProfileHomeSchool(profile);

  return pageMetadata({
    title: profile.name,
    description:
      profile.bio ||
      (homeSchool
        ? `${profile.name} plays at ${homeSchool.name} on Campus Gaming Network.`
        : `${profile.name} on Campus Gaming Network.`),
    path: `/users/${profile.id}`
  });
}

export default async function PublicProfilePage({ params }: PageProps) {
  const { id } = await params;
  const [currentUser, profile] = await Promise.all([
    currentProfile(),
    getPublicProfile(id).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        notFound();
      }

      throw error;
    })
  ]);
  const homeSchool = publicProfileHomeSchool(profile);

  return (
    <main className="narrow">
      <section className="profile-hero">
        <UserAvatar avatarURL={profile.avatar_url} name={profile.name} />
        <div>
          <p className="eyebrow">Public profile</p>
          <h1>{profile.name}</h1>
          <p className="lede">
            {profile.bio || "This profile is ready for campus gaming activity."}
          </p>
          <div className="pill-list" aria-label="Profile verification">
            <Chip>{verificationLabel(profile.verification_level)}</Chip>
            {profile.role_indicators?.map((role) => (
              <Chip key={role}>{roleIndicatorLabel(role)}</Chip>
            ))}
          </div>
        </div>
      </section>

      <section className="detail-grid" aria-label="Profile details">
        <div className="detail-row">
          <span>Verification</span>
          <strong>{verificationLabel(profile.verification_level)}</strong>
        </div>
        {profile.role_indicators && profile.role_indicators.length > 0 ? (
          <div className="detail-row">
            <span>Roles</span>
            <strong>{profile.role_indicators.map(roleIndicatorLabel).join(", ")}</strong>
          </div>
        ) : null}
        <div className="detail-row">
          <span>Home school</span>
          <strong className="detail-value">
            {homeSchool.href ? (
              <Link className="link" href={homeSchool.href}>{homeSchool.name}</Link>
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
                <Chip>{link.label}</Chip>
              </a>
            ))}
          </div>
        </section>
      ) : (
        <EmptyState>No public links yet.</EmptyState>
      )}

      <Card className="action-panel" aria-labelledby="profile-safety">
        <h2 id="profile-safety">Safety</h2>
        {currentUser && currentUser.id !== profile.id ? (
          <ReportForm targetID={profile.id} targetType="user" />
        ) : currentUser ? (
          <p className="form-help">This is your profile.</p>
        ) : (
          <Link className="button button--primary" href={`/login?next=/users/${profile.id}`}>
            Log in to report this profile
          </Link>
        )}
      </Card>
    </main>
  );
}
