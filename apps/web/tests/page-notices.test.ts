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
  accountNotices,
  homeAccountNotices,
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
  { page: "/account", notices: accountNotices },
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

test("every failure notice renders as an alert and every other notice as a status", () => {
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
      assert.ok(
        markup.startsWith(
          `<div class="page-notice page-notice--${notice.severity}" role="${failure ? "alert" : "status"}" aria-live="polite">`,
        ),
        `${page} ${key}`,
      );
      assert.ok(markup.endsWith(`${message}</div>`), `${page} ${key}`);
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
  assert.deepEqual(validatePublicProfileSearch({ report: "failed" }), {
    report: "failed",
  });
});
