import { createFileRoute, Link } from "@tanstack/react-router";
import { publicPageHead } from "../components/public-page-head";
import { PageIntro } from "../components/page-heading";

const description =
  "How Campus Gaming Network connects collegiate gamers with events, teams, clubs, and campus activity.";

export const Route = createFileRoute("/about")({
  loader: ({ context }) => context.publicOrigin,
  head: ({ loaderData }) =>
    publicPageHead(loaderData, { title: "About", description, path: "/about" }),
  component: AboutPage,
});

function AboutPage() {
  return (
    <main className="prose">
      <PageIntro
        title="About Campus Gaming Network"
        lede="One place for college gamers in the United States to find events, teams, clubs, and other players at their own school and at other campuses."
      />
      <section aria-labelledby="about-why" className="about-section">
        <h2 id="about-why">Why it exists</h2>
        <p>
          Gaming on a campus is usually spread across group chats, club pages,
          and flyers. If you are new, or your school has no club for your game,
          it is hard to know who is playing and when. Campus Gaming Network puts
          each school’s events, teams, and clubs on one page, for casual and
          competitive players alike.
        </p>
      </section>
      <section aria-labelledby="about-what" className="about-section">
        <h2 id="about-what">What you can do</h2>
        <ul>
          <li>
            <Link to="/schools">Find your school</Link> and follow others to
            keep up with what is happening there.
          </li>
          <li>
            <Link to="/events">Browse events</Link>, RSVP, and add them to your
            calendar, or host your own with friends helping you run it.
          </li>
          <li>
            <Link to="/teams">Start or join a team</Link> for the games you
            play.
          </li>
          <li>
            <Link to="/clubs">Find your school’s gaming clubs</Link> and esports
            programs, and see how to join them.
          </li>
          <li>
            Show the games you play on your profile, and see what is popular at
            your school.
          </li>
        </ul>
        <p>
          You can browse schools, events, teams, and clubs without an account.
          The <Link to="/faq">FAQ</Link> covers how each of these works.
        </p>
      </section>
      <section aria-labelledby="about-who" className="about-section">
        <h2 id="about-who">Who it is for</h2>
        <p>
          Anyone 18 or older with a tie to college gaming: students, graduate
          students, alumni, faculty, and staff. Any email address works, and
          verifying a .edu address adds a verified student badge to your
          profile.
        </p>
      </section>
      <section aria-labelledby="about-run" className="about-section">
        <h2 id="about-run">How it is run</h2>
        <p>
          Campus Gaming Network is an independent project built and maintained
          by one developer. It is not run by a school, a game publisher, or a
          tournament organizer. Accounts are free.
        </p>
      </section>
      <section aria-labelledby="about-support" className="about-section">
        <h2 id="about-support">Support the project</h2>
        <p>
          Donations are optional and help pay for hosting and development. If
          you would like to chip in, you can{" "}
          <a href="https://buymeacoffee.com/cgnbrandon" rel="noreferrer">
            donate on Buy Me a Coffee
          </a>
          . Donating does not change your account or unlock anything.
        </p>
      </section>
      <section aria-labelledby="about-contact" className="about-section">
        <h2 id="about-contact">Get in touch</h2>
        <p>
          Questions, feedback, or a school that is missing? Send a{" "}
          <Link to="/support">support request</Link>. Run a club that is not
          listed? Send a{" "}
          <Link to="/support" search={{ topic: "club" }}>
            club request
          </Link>
          . You do not need an account.
        </p>
      </section>
    </main>
  );
}
