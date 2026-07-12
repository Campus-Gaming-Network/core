import { SupportTicketForm } from "../../components/support-ticket-form";

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
