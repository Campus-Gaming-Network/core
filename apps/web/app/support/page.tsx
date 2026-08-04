import { SupportTicketForm } from "../../components/support-ticket-form";
import { pageMetadata } from "../../lib/metadata";

export const metadata = pageMetadata({
  title: "Support",
  description:
    "Get help with Campus Gaming Network or send the team a support request.",
  path: "/support"
});

export default function SupportPage() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">Support</p>
        <h1>Need help?</h1>
        <p className="lede">
          Submit a ticket and we will queue it for review. You can send one
          whether or not you are logged in.
        </p>
      </section>
      <SupportTicketForm />
    </main>
  );
}
