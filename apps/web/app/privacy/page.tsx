import { pageMetadata } from "../../lib/metadata";

export const metadata = pageMetadata({
  title: "Privacy",
  description:
    "How Campus Gaming Network collects, uses, and protects your information.",
  path: "/privacy"
});

export default function PrivacyPage() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Privacy</p>
        <h1>Privacy placeholder</h1>
        <p className="lede">
          Campus Gaming Network stores account, profile, school, and session
          information. A reviewed privacy policy is still required before public
          launch.
        </p>
      </section>
      <p>
        This stub exists so the route is present during Phase 1 UI work without
        pretending legal copy has been finalized.
      </p>
    </main>
  );
}
