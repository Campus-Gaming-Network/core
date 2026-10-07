import { createFileRoute, Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { publicPageHead } from "../components/public-page-head";

const description =
  "Answers to common questions about accounts, events, teams, and schools on Campus Gaming Network.";

type FAQ = {
  /** The answer's anchor. Support replies link to it, so it never changes
      once published, even when the question is reworded. */
  id: string;
  question: string;
  answer: ReactNode;
};

type FAQGroup = {
  id: string;
  heading: string;
  items: FAQ[];
};

const groups: FAQGroup[] = [
  {
    id: "about",
    heading: "About",
    items: [
      {
        id: "what-is-cgn",
        question: "What is Campus Gaming Network?",
        answer: (
          <>
            A place for college gamers in the United States to find events,
            teams, and other players at their own school and at other campuses.
            You can <Link to="/schools">browse schools</Link> and{" "}
            <Link to="/events">events</Link> without an account.
          </>
        ),
      },
      {
        id: "who-can-join",
        question: "Who can join?",
        answer: (
          <>
            Anyone 18 or older, including students, graduate students, alumni,
            faculty, and staff. Any email address works. Verifying a .edu
            address adds a verified student badge to your profile.
          </>
        ),
      },
      {
        id: "cost",
        question: "Does it cost anything?",
        answer: (
          <>
            No. Accounts are free. An organizer can list a paid event, but they
            collect payment themselves somewhere else. Campus Gaming Network
            does not take payments for events.
          </>
        ),
      },
      {
        id: "donate",
        question: "Can I support the project?",
        answer: (
          <>
            Yes. Campus Gaming Network is built and maintained by one developer,
            and donations help pay for hosting and development. You can{" "}
            <a href="https://buymeacoffee.com/cgnbrandon" rel="noreferrer">
              donate on Buy Me a Coffee
            </a>
            . Donating is optional and does not change your account or unlock
            anything.
          </>
        ),
      },
    ],
  },
  {
    id: "accounts",
    heading: "Accounts",
    items: [
      {
        id: "verify-email",
        question: "Do I need to verify my email?",
        answer: (
          <>
            Yes. We email you a verification link when you sign up, and you
            cannot log in until you confirm it. If the email did not arrive, you
            can <Link to="/auth/verify-email">request another one</Link>.
          </>
        ),
      },
      {
        id: "reset-password",
        question: "I forgot my password. How do I get back in?",
        answer: (
          <>
            <Link to="/forgot-password">Ask for a reset link</Link> and we will
            email it to the address on your account.
          </>
        ),
      },
      {
        id: "edit-profile",
        question: "How do I change my name, bio, or time zone?",
        answer: (
          <>
            Open{" "}
            <Link to="/account" hash="profile">
              Profile settings
            </Link>{" "}
            on your account page. You can also add social links there. Event
            times are shown in the time zone you choose.
          </>
        ),
      },
      {
        id: "member-lists",
        question: "Who can see that I am going to an event or on a team?",
        answer: (
          <>
            Signed-in people can see who is going to an event, who belongs to a
            school, and who is on a team. Visitors who are not signed in see
            only the counts. To hide yourself from every list, turn off “Show me
            in member lists” in{" "}
            <Link to="/account" hash="profile">
              Profile settings
            </Link>
            . Your RSVPs and memberships stay as they are.
          </>
        ),
      },
      {
        id: "delete-account",
        question: "How do I delete my account?",
        answer: (
          <>
            Use{" "}
            <Link to="/account" hash="delete">
              Delete your account
            </Link>{" "}
            on your account page. Deleting is permanent. Your personal
            information is removed, and anything that stays on the site, such as
            a past event, shows “Deleted User” in place of your name.
          </>
        ),
      },
    ],
  },
  {
    id: "schools",
    heading: "Schools",
    items: [
      {
        id: "which-schools",
        question: "Which schools are listed?",
        answer: (
          <>
            Colleges and universities in the United States. A branch campus has
            its own page, the same as a main campus. You can{" "}
            <Link to="/schools">search the full list</Link> without an account.
          </>
        ),
      },
      {
        id: "missing-school",
        question: "My school is not listed. Can I add it?",
        answer: (
          <>
            Schools cannot be added from the site. Send us a{" "}
            <Link to="/support">support request</Link> with the school’s name
            and location so we can review it.
          </>
        ),
      },
      {
        id: "follow-schools",
        question: "Can I keep up with more than one school?",
        answer: (
          <>
            Yes. You choose one home school when you sign up, and you can follow
            any other school from its page. Events at the schools you follow
            appear on your account page.
          </>
        ),
      },
    ],
  },
  {
    id: "events",
    heading: "Events",
    items: [
      {
        id: "create-event",
        question: "Who can create an event?",
        answer: (
          <>
            Anyone who is signed in can{" "}
            <Link to="/events/new">create an event</Link>, and it is published
            without an approval step. An event can be online, in person, or
            both, and it can repeat weekly, every two weeks, or monthly.
          </>
        ),
      },
      {
        id: "event-visibility",
        question:
          "What is the difference between public, unlisted, and private events?",
        answer: (
          <>
            A public event appears when people browse events. An unlisted event
            can be opened only by someone who has its link. A private event also
            needs a password, and its details stay hidden until the password is
            entered. The organizer shares the link and password themselves.
          </>
        ),
      },
      {
        id: "rsvp",
        question: "How do I RSVP, and what happens after?",
        answer: (
          <>
            Answer yes, maybe, or no on the event’s page. A yes sends you a
            confirmation email with a calendar file, and every event page has an
            “Add to calendar” link. Marking an event as interested saves it for
            later and is not an RSVP.
          </>
        ),
      },
      {
        id: "event-full",
        question: "What happens when an event is full?",
        answer: (
          <>
            An organizer can set a capacity, which counts yes RSVPs only. Once
            it is reached, nobody else can answer yes. There is no waitlist.
          </>
        ),
      },
      {
        id: "edit-cancel-event",
        question: "Can I change or cancel an event I created?",
        answer: (
          <>
            Yes. Only the organizer can edit or cancel an event. When an event
            is cancelled, we email everyone who answered yes or maybe.
          </>
        ),
      },
    ],
  },
  {
    id: "teams",
    heading: "Teams",
    items: [
      {
        id: "create-team",
        question: "How do I create a team?",
        answer: (
          <>
            Anyone who is signed in can{" "}
            <Link to="/teams/new">create a team</Link> and belong to more than
            one. You set a join password when you create it.
          </>
        ),
      },
      {
        id: "join-team",
        question: "How do I join a team?",
        answer: (
          <>
            Open the team’s page and enter its join password, which the team’s
            owner shares with the people they want on the team. Team pages are
            public, so anyone can <Link to="/teams">browse teams</Link> and read
            about one before joining.
          </>
        ),
      },
      {
        id: "team-roles",
        question: "Who manages a team?",
        answer: (
          <>
            The person who creates a team is its owner. The owner can make
            members captains and can transfer ownership to another member.
          </>
        ),
      },
    ],
  },
  {
    id: "games",
    heading: "Games",
    items: [
      {
        id: "game-list",
        question: "Where does the list of games come from?",
        answer: (
          <>
            Games and their cover art come from IGDB. Events and teams are
            tagged with the games they play, so you can filter by game.
          </>
        ),
      },
      {
        id: "missing-game",
        question: "The game I want is not listed. What can I do?",
        answer: (
          <>
            When you create an event or a team, search for the game and add it,
            or type its name. Neither needs approval. A game added from search
            is then listed for everyone.
          </>
        ),
      },
    ],
  },
  {
    id: "help",
    heading: "Safety and help",
    items: [
      {
        id: "report",
        question: "How do I report an event or a person?",
        answer: (
          <>
            Sign in, then use “Report this event” on the event’s page or “Report
            this user” on the person’s profile. Our team reviews every report.
          </>
        ),
      },
      {
        id: "contact-support",
        question: "How do I get help with something else?",
        answer: (
          <>
            Send a <Link to="/support">support request</Link>. You do not need
            an account.
          </>
        ),
      },
    ],
  },
];

export const Route = createFileRoute("/faq")({
  loader: ({ context }) => context.publicOrigin,
  head: ({ loaderData }) =>
    publicPageHead(loaderData, { title: "FAQ", description, path: "/faq" }),
  component: FAQPage,
});

function FAQPage() {
  return (
    <main className="narrow">
      <section className="page-heading">
        <p className="eyebrow">FAQ</p>
        <h1>Frequently asked questions.</h1>
      </section>
      {groups.map((group) => (
        <section
          aria-labelledby={`${group.id}-questions`}
          className="faq-group"
          key={group.id}
        >
          <h2 id={`${group.id}-questions`}>{group.heading}</h2>
          {group.items.map((item) => (
            <details id={item.id} key={item.id}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </section>
      ))}
      <p>
        Game data from{" "}
        <a href="https://www.igdb.com/" rel="noreferrer">
          IGDB.com
        </a>
        .
      </p>
    </main>
  );
}
