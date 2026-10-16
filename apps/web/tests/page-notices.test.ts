import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  pageNoticeKey,
  type PageNotice,
} from "../src/components/page-notice.js";
import { PageNoticeView } from "../src/components/page-notice-view.js";
import {
  deleteAccountNotices,
  homeAccountNotices,
  settingsNotices,
} from "../src/features/account-slice/presentation.js";
import { validateEventsSearch } from "../src/features/event-slice/contracts.js";
import {
  eventBrowseNotices,
  eventDetailNotices,
} from "../src/features/event-slice/presentation.js";
import { validatePublicProfileSearch } from "../src/features/public-profile/contracts.js";
import { reportUserNotices } from "../src/features/public-profile/presentation.js";
import {
  validateSchoolSearch,
  validateSchoolsSearch,
} from "../src/features/school-slice/contracts.js";
import {
  schoolBrowseNotices,
  schoolDetailNotices,
} from "../src/features/school-slice/presentation.js";
import {
  validateTeamDetailSearch,
  validateTeamsSearch,
} from "../src/features/team-slice/contracts.js";
import {
  teamBrowseNotices,
  teamDetailNotices,
} from "../src/features/team-slice/presentation.js";

const pages: Array<{ page: string; notices: Record<string, PageNotice> }> = [
  { page: "/events", notices: eventBrowseNotices },
  { page: "/events/$slug", notices: eventDetailNotices },
  { page: "/teams", notices: teamBrowseNotices },
  { page: "/teams/$slug", notices: teamDetailNotices },
  { page: "/schools", notices: schoolBrowseNotices },
  { page: "/schools/$slug", notices: schoolDetailNotices },
  { page: "/settings/delete-account", notices: deleteAccountNotices },
  { page: "/settings/profile", notices: settingsNotices },
  { page: "/", notices: homeAccountNotices },
  { page: "/users/$id", notices: reportUserNotices },
];

const unknownValues: unknown[] = [
  undefined,
  "",
  "bogus",
  "constructor",
  "__proto__",
  "toString",
  42,
  { failed: true },
  ["bogus", "failed"],
];

test("every failure notice renders as an alert and every other notice as an announced status", () => {
  for (const { page, notices } of pages) {
    for (const [key, notice] of Object.entries(notices)) {
      const failure = key === "failed" || key.endsWith("-failed");
      assert.equal(notice.severity, failure ? "danger" : "success", key);
      const markup = renderToStaticMarkup(
        createElement(PageNoticeView, { notice }),
      );
      const message = renderToStaticMarkup(
        createElement("p", null, notice.message),
      );
      // A failure is an alert. A success is a plain banner plus a polite
      // status region the browser fills after hydration, so the message is
      // announced (a region that arrives already filled is not).
      const [opening, closing] = failure
        ? [
            '<div class="page-notice page-notice--danger" role="alert">',
            `${message}</div>`,
          ]
        : [
            '<div class="page-notice page-notice--success">',
            `${message}</div><p aria-live="polite" class="visually-hidden" role="status"></p>`,
          ];
      assert.ok(markup.startsWith(opening), `${page} ${key}`);
      assert.ok(markup.endsWith(closing), `${page} ${key}`);
    }
  }
});

test("pages accept only the notices they define and render nothing otherwise", () => {
  for (const { page, notices } of pages) {
    for (const key of Object.keys(notices)) {
      assert.equal(pageNoticeKey(notices, key), key, `${page} ${key}`);
      assert.equal(
        pageNoticeKey(notices, [key, "bogus"]),
        key,
        `${page} ${key}`,
      );
    }
    for (const value of unknownValues) {
      assert.equal(
        pageNoticeKey(notices, value),
        undefined,
        `${page} ${String(value)}`,
      );
    }
  }
  assert.equal(
    renderToStaticMarkup(createElement(PageNoticeView, { notice: undefined })),
    "",
  );
});

test("search validators read notices from their own page", () => {
  assert.deepEqual(validateEventsSearch({ event: "rsvp-failed" }), {
    event: "rsvp-failed",
  });
  assert.deepEqual(validateEventsSearch({ event: "created" }), {});
  assert.deepEqual(validateTeamsSearch({ team: "join-failed" }), {
    team: "join-failed",
  });
  assert.deepEqual(validateTeamsSearch({ team: "joined" }), {});
  assert.deepEqual(validateTeamDetailSearch({ team: "joined" }), {
    team: "joined",
  });
  assert.deepEqual(validateSchoolsSearch({ follow: "added" }), {});
  assert.deepEqual(validateSchoolSearch({ follow: "added" }), {
    follow: "added",
  });
  assert.deepEqual(validateSchoolSearch({ follow: "added", tab: "teams" }), {
    follow: "added",
    tab: "teams",
  });
  assert.deepEqual(validateSchoolSearch({ tab: "people" }), {});
  assert.deepEqual(validatePublicProfileSearch({ report: "failed" }), {
    report: "failed",
  });
});
