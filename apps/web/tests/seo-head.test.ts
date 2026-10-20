import assert from "node:assert/strict";
import { test } from "vite-plus/test";
import type { EventDTO } from "../src/features/event-slice/contracts.js";
import {
  eventDetailHead,
  isoWithOffset,
  privateEventPreview,
  restrictedEventPreview,
} from "../src/features/event-slice/event-head.js";
import {
  pageHead,
  type PageHeadOptions,
} from "../src/components/public-page-head.js";
import { schoolHead } from "../src/features/school-slice/presentation.js";
import { teamHead } from "../src/features/team-slice/presentation.js";
import type { TeamDTO } from "../src/features/team-slice/contracts.js";
import { publicProfileHead } from "../src/features/public-profile/presentation.js";

const origin = "https://cgn.example";
const defaultAlt =
  "Campus Gaming Network: find campus gaming events, teams, and clubs near you";

const baseEvent: EventDTO = {
  id: "event-1",
  title: "Open Night",
  slug: "open-night",
  description: "Bring a controller.",
  visibility: "public",
  format: "in_person",
  audience: "open",
  starts_at: "2031-05-02T02:00:00Z",
  ends_at: "2031-05-02T05:00:00Z",
  timezone: "America/Los_Angeles",
  location_name: "Student Union",
  address: "1 Campus Way",
  online_url: "https://meet.example/secret-room",
  rsvp_yes_count: 0,
  interest_count: 0,
  lifecycle: "upcoming",
  cost: "free",
  host_school: {
    id: "school-1",
    name: "Example University",
    slug: "example-university",
  },
  games: [],
  organizers: [
    {
      id: "user-1",
      public_id: "Ab3dEf5hJk",
      name: "Private Organizer",
      role: "creator",
      verification_level: "verified",
    },
  ],
};

function metaContent(
  head: { meta: Array<Record<string, unknown>> },
  key: string,
): unknown {
  return head.meta.find((tag) => tag.name === key || tag.property === key)
    ?.content;
}

test("a public page head has canonical, Open Graph, and large Twitter card tags", () => {
  assert.deepEqual(
    pageHead(origin, {
      title: "About",
      description: "About us.",
      path: "/about",
    }),
    {
      meta: [
        { title: "About | Campus Gaming Network" },
        { name: "description", content: "About us." },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Campus Gaming Network" },
        { property: "og:title", content: "About | Campus Gaming Network" },
        { property: "og:description", content: "About us." },
        { property: "og:url", content: `${origin}/about` },
        { property: "og:image", content: `${origin}/og-default.png` },
        { property: "og:image:alt", content: defaultAlt },
        { property: "og:image:width", content: "1200" },
        { property: "og:image:height", content: "630" },
        { name: "twitter:card", content: "summary_large_image" },
        { name: "twitter:title", content: "About | Campus Gaming Network" },
        { name: "twitter:description", content: "About us." },
        { name: "twitter:image", content: `${origin}/og-default.png` },
        { name: "twitter:image:alt", content: defaultAlt },
      ],
      links: [{ rel: "canonical", href: `${origin}/about` }],
    },
  );
});

test("a noindex page head has robots, no canonical, no image, and no structured data", () => {
  assert.deepEqual(
    pageHead(origin, {
      title: "Account",
      description: "Yours.",
      path: "/account",
      noIndex: true,
      jsonLd: { "@type": "Thing" },
    }),
    {
      meta: [
        { title: "Account | Campus Gaming Network" },
        { name: "description", content: "Yours." },
        { name: "robots", content: "noindex,nofollow" },
        { property: "og:type", content: "website" },
        { property: "og:site_name", content: "Campus Gaming Network" },
        { property: "og:title", content: "Account | Campus Gaming Network" },
        { property: "og:description", content: "Yours." },
        { property: "og:url", content: `${origin}/account` },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: "Account | Campus Gaming Network" },
        { name: "twitter:description", content: "Yours." },
      ],
      links: [],
    },
  );
});

test("a public open event gets a full preview and schema.org Event data", () => {
  const head = eventDetailHead({ event: baseEvent, publicOrigin: origin }, [
    { rel: "stylesheet", href: "/event.css" },
  ]);

  assert.equal(
    metaContent(head, "og:title"),
    "Open Night | Campus Gaming Network",
  );
  assert.equal(
    metaContent(head, "description"),
    "Thu, May 1, 7:00 PM to 10:00 PM PDT at Student Union. Bring a controller.",
  );
  assert.equal(metaContent(head, "robots"), undefined);
  assert.deepEqual(head.links, [
    { rel: "canonical", href: `${origin}/events/open-night` },
    { rel: "stylesheet", href: "/event.css" },
  ]);
  assert.deepEqual(
    head.meta.find((tag) => "script:ld+json" in tag),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "Event",
        name: "Open Night",
        description: "Bring a controller.",
        url: `${origin}/events/open-night`,
        startDate: "2031-05-01T19:00:00-07:00",
        endDate: "2031-05-01T22:00:00-07:00",
        eventStatus: "https://schema.org/EventScheduled",
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        location: {
          "@type": "Place",
          name: "Student Union",
          address: "1 Campus Way",
        },
        organizer: {
          "@type": "CollegeOrUniversity",
          name: "Example University",
          url: `${origin}/schools/example-university`,
        },
        image: [`${origin}/og-default.png`],
        isAccessibleForFree: true,
      },
    },
  );
});

test("event structured data covers online and hybrid events without the meeting link or people", () => {
  const online = eventDetailHead({
    event: { ...baseEvent, format: "online" },
    publicOrigin: origin,
  });
  const hybrid = eventDetailHead({
    event: { ...baseEvent, format: "hybrid" },
    publicOrigin: origin,
  });
  const onlineData = JSON.stringify(online.meta);
  const hybridData = JSON.stringify(hybrid.meta);

  assert.match(onlineData, /OnlineEventAttendanceMode/);
  assert.match(
    onlineData,
    /"location":\{"@type":"VirtualLocation","url":"https:\/\/cgn\.example\/events\/open-night"\}/,
  );
  assert.match(hybridData, /MixedEventAttendanceMode/);
  assert.match(hybridData, /"@type":"Place"[\s\S]*"@type":"VirtualLocation"/);
  for (const data of [onlineData, hybridData]) {
    assert.equal(data.includes("secret-room"), false);
    assert.equal(data.includes("Private Organizer"), false);
  }
});

test("event times keep the event's own UTC offset across daylight saving and UTC", () => {
  assert.equal(
    isoWithOffset("2031-01-15T20:30:00Z", "America/New_York"),
    "2031-01-15T15:30:00-05:00",
  );
  assert.equal(
    isoWithOffset("2031-07-15T20:30:00Z", "America/New_York"),
    "2031-07-15T16:30:00-04:00",
  );
  assert.equal(
    isoWithOffset("2031-07-15T20:30:00Z", "UTC"),
    "2031-07-15T20:30:00+00:00",
  );
  assert.equal(
    isoWithOffset("2031-07-15T20:30:00Z", "Asia/Kolkata"),
    "2031-07-16T02:00:00+05:30",
  );
});

test("an unlisted event keeps its preview but is noindex and has no structured data", () => {
  const head = eventDetailHead({
    event: { ...baseEvent, visibility: "unlisted" },
    publicOrigin: origin,
  });

  assert.equal(
    metaContent(head, "og:title"),
    "Open Night | Campus Gaming Network",
  );
  assert.equal(metaContent(head, "robots"), "noindex,nofollow");
  assert.deepEqual(head.links, []);
  assert.equal(
    head.meta.some((tag) => "script:ld+json" in tag),
    false,
  );
});

test("locked and restricted-audience events never put details in the head", () => {
  const cases = [
    {
      name: "locked",
      event: {
        slug: "secret-plans",
        visibility: "private",
        locked: true,
      } as const,
      preview: privateEventPreview,
    },
    {
      name: "campus",
      event: { ...baseEvent, audience: "campus" } as EventDTO,
      preview: restrictedEventPreview,
    },
    {
      name: "members",
      event: {
        ...baseEvent,
        audience: "members",
        visibility: "unlisted",
      } as EventDTO,
      preview: restrictedEventPreview,
    },
  ];

  for (const { name, event, preview } of cases) {
    const head = eventDetailHead({ event, publicOrigin: origin });
    const serialized = JSON.stringify(head);

    assert.equal(metaContent(head, "robots"), "noindex,nofollow", name);
    assert.equal(
      metaContent(head, "og:title"),
      `${preview.title} | Campus Gaming Network`,
      name,
    );
    assert.equal(
      metaContent(head, "og:description"),
      preview.description,
      name,
    );
    assert.equal(metaContent(head, "og:image"), undefined, name);
    assert.deepEqual(head.links, [], name);
    for (const leaked of [
      "Open Night",
      "Bring a controller",
      "Student Union",
      "1 Campus Way",
      "Example University",
      "ld+json",
      "startDate",
    ]) {
      assert.equal(
        serialized.includes(leaked),
        false,
        `${name} leaks ${leaked}`,
      );
    }
  }
});

test("someone who can see a private event gets its name in the tab, and nothing else", () => {
  const head = eventDetailHead({
    event: { ...baseEvent, visibility: "private" } as EventDTO,
    publicOrigin: origin,
  });
  const { title } = head.meta.find((tag) => "title" in tag) as {
    title: string;
  };
  const rest = JSON.stringify(head.meta.filter((tag) => !("title" in tag)));

  assert.deepEqual(
    {
      title,
      ogTitle: metaContent(head, "og:title"),
      robots: metaContent(head, "robots"),
      leaks: ["Open Night", "Bring a controller", "ld+json"].filter((text) =>
        rest.includes(text),
      ),
    },
    {
      title: "Open Night | Campus Gaming Network",
      ogTitle: "Private event | Campus Gaming Network",
      robots: "noindex,nofollow",
      leaks: [],
    },
  );
});

test("team and school heads carry SportsTeam and school structured data, not people", () => {
  const team: TeamDTO = {
    id: "team-1",
    name: "Night Owls",
    slug: "night-owls",
    description: "We play late.",
    member_count: 4,
    school: {
      id: "school-1",
      name: "Example University",
      slug: "example-university",
    },
    games: [],
  };
  const teamData = teamHead(team, origin).meta.find(
    (tag) => "script:ld+json" in tag,
  );

  assert.deepEqual(teamData, {
    "script:ld+json": {
      "@context": "https://schema.org",
      "@type": "SportsTeam",
      name: "Night Owls",
      url: `${origin}/teams/night-owls`,
      description: "We play late.",
      sport: "Esports",
      parentOrganization: {
        "@type": "CollegeOrUniversity",
        name: "Example University",
        url: `${origin}/schools/example-university`,
      },
    },
  });

  const schoolHeadData = schoolHead(
    {
      id: "school-1",
      name: "Example University",
      slug: "example-university",
      city: "Irvine",
      state: "CA",
      website_url: "https://example.edu",
      logo_url: "https://cdn.example/logo.png",
      is_main_campus: true,
      num_branches: 0,
    },
    origin,
  );
  assert.equal(
    metaContent(schoolHeadData, "og:image"),
    "https://cdn.example/logo.png",
  );
  assert.equal(metaContent(schoolHeadData, "twitter:card"), "summary");
  assert.deepEqual(
    schoolHeadData.meta.find((tag) => "script:ld+json" in tag),
    {
      "script:ld+json": {
        "@context": "https://schema.org",
        "@type": "CollegeOrUniversity",
        name: "Example University",
        url: `${origin}/schools/example-university`,
        sameAs: ["https://example.edu/"],
        logo: "https://cdn.example/logo.png",
        address: {
          "@type": "PostalAddress",
          addressLocality: "Irvine",
          addressRegion: "CA",
          addressCountry: "US",
        },
      },
    },
  );
});

test("a public profile head is generic and noindex so it cannot expose someone who opted out of lists", () => {
  const loaderData = {
    profile: {
      id: "user-1",
      public_id: "Cd4eFg6hKm",
      name: "Hidden Student",
      bio: "Secret bio",
      home_school: { name: "Example University" },
    },
    publicOrigin: origin,
  };
  const head = publicProfileHead(loaderData);
  const serialized = JSON.stringify(head);

  assert.equal(metaContent(head, "robots"), "noindex,nofollow");
  assert.equal(metaContent(head, "og:url"), `${origin}/users/Cd4eFg6hKm`);
  for (const leaked of ["Hidden Student", "Secret bio", "Example University"]) {
    assert.equal(serialized.includes(leaked), false, leaked);
  }
});

test("an event with a host logo uses it as the preview image, and a long event names both days", () => {
  const head = eventDetailHead({
    event: {
      ...baseEvent,
      format: "hybrid",
      ends_at: "2031-05-03T05:00:00Z",
      host_school: {
        ...baseEvent.host_school,
        logo_url: "/school-logos/example.png",
      },
    },
    publicOrigin: origin,
  });

  assert.deepEqual(
    ["description", "og:image", "og:image:alt", "twitter:card"].map((key) =>
      metaContent(head, key),
    ),
    [
      "Thu, May 1, 7:00 PM to Fri, May 2, 10:00 PM PDT at Student Union and online. Bring a controller.",
      `${origin}/school-logos/example.png`,
      "Example University logo",
      "summary",
    ],
  );
});

test("a page with breadcrumbs adds a BreadcrumbList that ends at the page, and noindex pages get none", () => {
  const options: PageHeadOptions = {
    title: "Example University",
    description: "A school.",
    path: "/schools/example-university",
    breadcrumbs: [{ name: "Schools", path: "/schools" }],
  };

  assert.deepEqual(
    pageHead(origin, options).meta.filter((tag) => "script:ld+json" in tag),
    [
      {
        "script:ld+json": {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            {
              "@type": "ListItem",
              position: 1,
              name: "Home",
              item: origin,
            },
            {
              "@type": "ListItem",
              position: 2,
              name: "Schools",
              item: `${origin}/schools`,
            },
            {
              "@type": "ListItem",
              position: 3,
              name: "Example University",
              item: `${origin}/schools/example-university`,
            },
          ],
        },
      },
    ],
  );
  assert.deepEqual(
    pageHead(origin, { ...options, noIndex: true }).meta.filter(
      (tag) => "script:ld+json" in tag,
    ),
    [],
  );
});

test("a team uses its first game cover as the preview image, with alt text", () => {
  const team: TeamDTO = {
    id: "team-1",
    name: "Night Owls",
    slug: "night-owls",
    description: "",
    member_count: 3,
    games: [
      { id: "g1", name: "No Cover", slug: "no-cover", has_cover: false },
      { id: "g2", name: "Rocket Arena", slug: "rocket-arena", has_cover: true },
    ],
  };
  const head = teamHead(team, origin);

  assert.deepEqual(
    ["og:image", "og:image:alt", "twitter:card"].map((key) =>
      metaContent(head, key),
    ),
    [
      `${origin}/api/games/rocket-arena/cover`,
      "Rocket Arena cover art",
      "summary",
    ],
  );
});
