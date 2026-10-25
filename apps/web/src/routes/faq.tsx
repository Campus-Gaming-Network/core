import {
  createFileRoute,
  Link,
  useHydrated,
  useLocation,
} from "@tanstack/react-router";
import { Check, Link2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { PageIntro } from "../components/page-heading";
import { publicPageHead } from "../components/public-page-head";

const description =
  "Answers to common questions about accounts, events, teams, clubs, and schools on Campus Gaming Network.";

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
            teams, clubs, and other players at their own school and at other
            campuses. You can browse <Link to="/schools">schools</Link>,{" "}
            <Link to="/events">events</Link>, <Link to="/teams">teams</Link>,
            and <Link to="/clubs">clubs</Link> without an account.
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
            Open <Link to="/settings/profile">Edit profile</Link> from your
            account menu. You can also add social links there. Event times are
            shown in the time zone you choose.
          </>
        ),
      },
      {
        id: "change-email-password",
        question: "How do I change my email or password?",
        answer: (
          <>
            Open <Link to="/settings/security">Email and password</Link> in your
            account settings. Both changes ask for your current password. A new
            email address takes effect once you follow the link we send to it,
            and we tell your old address about the change. Changing your
            password signs you out on your other devices.
          </>
        ),
      },
      {
        id: "notifications",
        question: "Where do I see updates about my events?",
        answer: (
          <>
            On <Link to="/notifications">Notifications</Link>, linked from the
            header with a count of anything unread. It tells you when an event
            you are going to is cancelled, and when someone accepts your invite
            to help run an event.
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
            in member lists” in <Link to="/settings/profile">Edit profile</Link>
            . Your RSVPs and memberships stay as they are.
          </>
        ),
      },
      {
        id: "download-data",
        question: "Can I get a copy of my data?",
        answer: (
          <>
            Yes. <Link to="/settings/data">Your data</Link> downloads a file
            with your account, profile, schools, game lists, teams, events, and
            other activity, after you enter your password. To correct something,
            edit your profile or send a{" "}
            <Link to="/support" search={{ topic: "privacy" }}>
              privacy request
            </Link>
            .
          </>
        ),
      },
      {
        id: "delete-account",
        question: "How do I delete my account?",
        answer: (
          <>
            Use <Link to="/settings/delete-account">Delete account</Link> in
            your account settings. Deleting is permanent. Your personal
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
        id: "find-events",
        question: "How do I find events?",
        answer: (
          <>
            <Link to="/events">Browse events</Link> to search event titles and
            narrow the list by game, school, format, type, audience, cost, and
            dates. The tabs jump to events at your school, online events, and
            tournaments.
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
            Yes. You and any co-organizers can edit it, and only you, as its
            creator, can cancel it. When an event is cancelled, we email
            everyone who answered yes or maybe, and it shows in their
            notifications.
          </>
        ),
      },
      {
        id: "co-organizers",
        question: "Can other people help me run an event?",
        answer: (
          <>
            Yes. From your event’s page, invite up to nine co-organizers by
            email. The link works for seven days, and they accept by signing in
            with that address. Co-organizers can edit the event and can step
            down at any time. Only you can cancel the event or manage its
            co-organizers, and you can hand the event to one of them.
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
    id: "clubs",
    heading: "Clubs",
    items: [
      {
        id: "club-vs-team",
        question: "What is the difference between a club and a team?",
        answer: (
          <>
            A club is a school’s gaming club or esports program, and it belongs
            to that school. A team is a group anyone can start, at one school or
            across campuses, and people join it with a password. You can{" "}
            <Link to="/clubs">browse clubs</Link> without an account.
          </>
        ),
      },
      {
        id: "join-club",
        question: "How do I join a club?",
        answer: (
          <>
            Clubs are not run by Campus Gaming Network, so each one decides how
            people join. A club’s page has a How to join section, such as an
            interest form, a tryout, or a meeting to attend, when the club has
            said.
          </>
        ),
      },
      {
        id: "add-claim-club",
        question: "My club is missing, or I run one. What do I do?",
        answer: (
          <>
            Send a{" "}
            <Link to="/support" search={{ topic: "club" }}>
              club request
            </Link>{" "}
            with the club’s name and school. If you run it, link to its page on
            your school’s website or give an officer contact we can check; a
            school email address alone does not show that you run a club. We add
            missing clubs, and officers will be able to manage their club’s page
            soon.
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
            Games and their cover art come from IGDB. Events, teams, and clubs
            are tagged with the games they play, so you can filter by game. The
            home page and each school’s page show popular games, ranked by
            upcoming events.
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
      {
        id: "profile-games",
        question: "Can I show the games I play?",
        answer: (
          <>
            Yes. On <Link to="/settings/profile">Edit profile</Link>, add games
            to Favorite games (up to five), Games I like, or Want to play. Your
            lists appear on your public profile.
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
  usePrintOpensAnswers();
  useOpenLinkedQuestion();
  return (
    <main className="prose faq-page">
      <PageIntro title="Frequently asked questions" />
      <nav aria-label="Question topics" className="faq-topics">
        <ul>
          {groups.map((group) => (
            <li key={group.id}>
              <a className="faq-topics__link" href={`#${group.id}-questions`}>
                {group.heading}
              </a>
            </li>
          ))}
        </ul>
      </nav>
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
              <CopyQuestionLink id={item.id} />
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

/**
 * A link to the question that opened it, so a reply can point at one answer.
 * It needs JavaScript (the clipboard), so it appears once the page is
 * interactive; the question's own address is still in the URL after a click
 * on its summary or a topic link.
 */
function CopyQuestionLink({ id }: { id: string }) {
  const interactive = useHydrated();
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (status === "idle") return;
    const reset = setTimeout(() => setStatus("idle"), 4000);
    return () => clearTimeout(reset);
  }, [status]);

  if (!interactive) return null;
  async function copy() {
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }
  return (
    <p className="faq-copy">
      <button className="faq-copy__button" onClick={copy} type="button">
        {status === "copied" ? (
          <Check aria-hidden="true" size={16} strokeWidth={1.75} />
        ) : (
          <Link2 aria-hidden="true" size={16} strokeWidth={1.75} />
        )}
        {status === "copied" ? "Link copied" : "Copy link to this question"}
      </button>
      <span className="faq-copy__status" role="status">
        {status === "failed"
          ? "Could not copy. Copy the address bar instead."
          : ""}
      </span>
    </p>
  );
}

/**
 * Opens the question the address names (`/faq#delete-account`) and scrolls it
 * into view. The browser has already jumped to a closed answer by then, so
 * opening it moves the text; scrolling again keeps the question at the top.
 * Re-runs when the hash changes, such as a topic link or a pasted link.
 */
function useOpenLinkedQuestion() {
  const hash = useLocation({ select: (location) => location.hash });
  useEffect(() => {
    if (!hash) return;
    const element = document.getElementById(hash);
    if (!(element instanceof HTMLDetailsElement)) return;
    element.open = true;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    element.scrollIntoView({
      behavior: reduced.matches ? "auto" : "smooth",
      block: "start",
    });
  }, [hash]);
}

/**
 * Opens every answer for printing and closes the ones the reader had closed
 * afterwards. Chromium prints closed answers open through the print
 * stylesheet's `::details-content` rule; Firefox and Safari need the `open`
 * attribute.
 */
function usePrintOpensAnswers() {
  useEffect(() => {
    let opened: HTMLDetailsElement[] = [];
    function openAll() {
      opened = [
        ...document.querySelectorAll<HTMLDetailsElement>(
          "main details:not([open])",
        ),
      ];
      for (const details of opened) details.open = true;
    }
    function restore() {
      for (const details of opened) details.open = false;
      opened = [];
    }
    window.addEventListener("beforeprint", openAll);
    window.addEventListener("afterprint", restore);
    return () => {
      window.removeEventListener("beforeprint", openAll);
      window.removeEventListener("afterprint", restore);
    };
  }, []);
}
