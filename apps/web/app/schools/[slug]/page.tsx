import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Card } from "@heroui/react/card";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  followSchoolAction,
  unfollowSchoolAction
} from "../../actions";
import {
  ApiError,
  isSchoolFollowed,
  schoolLocation
} from "../../../lib/cgn-api";
import { pageMetadata } from "../../../lib/metadata";
import {
  currentProfile,
  getSchool,
  listFollowedSchools
} from "../../../lib/server-api";

type PageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata({
  params
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const school = await getSchool(slug).catch(() => null);

  if (!school) {
    return pageMetadata({
      title: "School not found",
      description: "This school is unavailable.",
      noIndex: true
    });
  }

  const location = schoolLocation(school);

  return pageMetadata({
    title: school.name,
    description: location
      ? `Campus gaming events, teams, and activity at ${school.name} in ${location}.`
      : `Campus gaming events, teams, and activity at ${school.name}.`,
    path: `/schools/${school.slug}`
  });
}

export default async function SchoolDetailPage({
  params,
  searchParams
}: PageProps) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [school, profile] = await Promise.all([
    getSchool(slug).catch((error) => {
      if (error instanceof ApiError && error.status === 404) {
        notFound();
      }

      throw error;
    }),
    currentProfile()
  ]);
  const followStatus = param(query.follow);
  const followedSchools = profile
    ? await listFollowedSchools().catch(() => [])
    : [];
  const isHomeSchool = profile?.home_school_id === school.id;
  const isFollowing = isSchoolFollowed(followedSchools, school.id);

  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">School</p>
        <h1>{school.name}</h1>
        <p className="lede">
          {[school.city, school.state, school.zip].filter(Boolean).join(", ") ||
            "Location details pending"}
        </p>
      </section>

      {followStatus ? <FollowNotice status={followStatus} /> : null}

      <section className="detail-grid" aria-label="School details">
        <div className="detail-row">
          <span>Campus type</span>
          <strong>
            {school.is_main_campus ? "Main campus" : "Branch campus"}
          </strong>
        </div>
        <div className="detail-row">
          <span>Known branches</span>
          <strong>{school.num_branches}</strong>
        </div>
        {school.unitid ? (
          <div className="detail-row">
            <span>Scorecard unit ID</span>
            <strong>{school.unitid}</strong>
          </div>
        ) : null}
        {school.website_url ? (
          <div className="detail-row">
            <span>Website</span>
            <a href={school.website_url}>{school.website_url}</a>
          </div>
        ) : null}
      </section>

      <Card className="action-panel" aria-labelledby="school-actions">
        <h2 id="school-actions">School actions</h2>
        {profile ? (
          isHomeSchool ? (
            <Alert status="success">
              This is your home school.
            </Alert>
          ) : isFollowing ? (
            <div>
              <Alert status="success">
                You are following this school.
              </Alert>
              <form action={unfollowSchoolAction}>
                <input type="hidden" name="school_id" value={school.id} />
                <input type="hidden" name="slug" value={school.slug} />
                <Button variant="secondary" type="submit">
                  Unfollow
                </Button>
              </form>
            </div>
          ) : (
            <div className="actions">
              <form action={followSchoolAction}>
                <input type="hidden" name="school_id" value={school.id} />
                <input type="hidden" name="slug" value={school.slug} />
                <Button type="submit">Follow school</Button>
              </form>
            </div>
          )
        ) : (
          <div className="actions">
            <Link className="button button--primary" href="/signup">
              Create account
            </Link>
            <Link className="button button--secondary" href={`/login?next=/schools/${school.slug}`}>
              Log in to follow
            </Link>
          </div>
        )}
      </Card>
    </main>
  );
}

function FollowNotice({ status }: { status: string }) {
  const messages: Record<string, string> = {
    added: "School followed.",
    failed: "We could not update this school follow. Please try again.",
    removed: "School unfollowed."
  };

  return (
    <Alert
      status={status === "failed" ? "danger" : "success"}
    >
      {messages[status] ?? ""}
    </Alert>
  );
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
