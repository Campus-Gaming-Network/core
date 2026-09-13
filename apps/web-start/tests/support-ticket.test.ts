import assert from "node:assert/strict";
import test from "node:test";
import {
  validateSupportSearch,
  validateSupportTicketServerInput
} from "../src/features/support-slice/contracts.js";
import {
  submitSupportTicketOperation
} from "../src/features/support-slice/support-operations.server.js";
import { createApiClient, type Fetcher } from "../src/server/api.server.js";
import { createGoBFFClient } from "../src/server/bff.server.js";
import {
  proxySecretHeader,
  visitorIPHeader
} from "../src/server/visitor-identity.server.js";

const validInput = {
  contact_email: "player@example.test",
  name: "Player One",
  subject: "Event listing question",
  message: "Could you help me correct an event listing?"
};

function client(fetcher: Fetcher) {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("support validation accepts typed and native values and trims every field", () => {
  const form = new FormData();
  form.set("contact_email", " player@example.test ");
  form.set("name", " Player One ");
  form.set("subject", " Event listing question ");
  form.set("message", " Could you help me correct an event listing? ");

  assert.deepEqual(validateSupportTicketServerInput(form), {
    valid: true,
    value: validInput
  });
  assert.deepEqual(validateSupportTicketServerInput(validInput), {
    valid: true,
    value: validInput
  });
});

test("support validation returns bounded accessible errors without echoing PII", () => {
  const privateEmail = "not-an-email-private-value";
  const privateMessage = "x".repeat(5001);
  const result = validateSupportTicketServerInput({
    contact_email: privateEmail,
    name: "x".repeat(121),
    subject: "",
    message: privateMessage
  });

  assert.equal(result.valid, false);
  if (result.valid) assert.fail("invalid support ticket passed validation");
  assert.deepEqual(result.fieldErrors.contact_email, [
    "Enter a valid email address."
  ]);
  assert.deepEqual(result.fieldErrors.name, [
    "Name must be 120 characters or fewer."
  ]);
  assert.deepEqual(result.fieldErrors.subject, ["Subject is required."]);
  assert.deepEqual(result.fieldErrors.message, [
    "Message must be 5000 characters or fewer."
  ]);
  assert.equal(JSON.stringify(result).includes(privateEmail), false);
  assert.equal(JSON.stringify(result).includes(privateMessage), false);
});

test("support operation works anonymously and strips its upstream response", async () => {
  let requestURL = "";
  let requestInit: RequestInit | undefined;
  const result = await submitSupportTicketOperation(validInput, {
    api: client(async (input, init) => {
      requestURL = String(input);
      requestInit = init;
      return Response.json({
        id: "ticket-1",
        contact_email: validInput.contact_email,
        message: validInput.message,
        internal_note: "never-return"
      }, { status: 201 });
    }),
    cookieHeader: ""
  });

  assert.equal(requestURL, "http://api:8080/support-tickets");
  assert.equal(requestInit?.method, "POST");
  assert.equal(requestInit?.cache, "no-store");
  assert.equal(new Headers(requestInit?.headers).get("cookie"), null);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), validInput);
  assert.deepEqual(result, {
    status: "success",
    message: "Support ticket submitted. We will review it soon."
  });
  assert.equal(JSON.stringify(result).includes(validInput.contact_email), false);
  assert.equal(JSON.stringify(result).includes(validInput.message), false);
  assert.equal(JSON.stringify(result).includes("internal_note"), false);
});

test("authenticated support forwards only the incoming cookie and server-derived visitor identity", async () => {
  let requestHeaders = new Headers();
  const api = createGoBFFClient({
    incomingHeaders: new Headers({
      "x-real-ip": "203.0.113.42",
      [visitorIPHeader]: "192.0.2.10",
      [proxySecretHeader]: "browser-secret"
    }),
    proxySecret: "trusted-proxy-secret",
    trustRailwayHeaders: true,
    baseUrl: "http://api:8080",
    fetcher: async (_input, init) => {
      requestHeaders = new Headers(init?.headers);
      return Response.json({ id: "ticket-2" }, { status: 201 });
    }
  });

  const result = await submitSupportTicketOperation(validInput, {
    api,
    cookieHeader: "cgn_session=session-value"
  });

  assert.equal(requestHeaders.get("cookie"), "cgn_session=session-value");
  assert.equal(requestHeaders.get(visitorIPHeader), "203.0.113.42");
  assert.equal(requestHeaders.get(proxySecretHeader), "trusted-proxy-secret");
  assert.deepEqual(result, {
    status: "success",
    message: "Support ticket submitted. We will review it soon."
  });
  assert.equal(JSON.stringify(result).includes("session-value"), false);
});

test("support API and contract failures are safe and never serialize submitted content", async () => {
  const cases: Array<{ fetcher: Fetcher; message: string }> = [
    {
      fetcher: async () => Response.json(
        { error: "support_ticket_failed" },
        { status: 500 }
      ),
      message: "We could not submit that support ticket. Please try again."
    },
    {
      fetcher: async () => Response.json({ id: "", private: validInput.message }),
      message: "Something went wrong. Please try again."
    },
    {
      fetcher: async () => { throw new Error(`private: ${validInput.message}`); },
      message: "Something went wrong. Please try again."
    }
  ];

  await Promise.all(cases.map(async ({ fetcher, message }) => {
    const reported: unknown[] = [];
    const result = await submitSupportTicketOperation(validInput, {
      api: client(fetcher),
      cookieHeader: "cgn_session=private-session",
      reportError: (error) => reported.push(error)
    });
    assert.deepEqual(result, { status: "error", message });
    assert.equal(reported.length, 1);
    assert.equal(JSON.stringify(result).includes(validInput.contact_email), false);
    assert.equal(JSON.stringify(result).includes(validInput.message), false);
    assert.equal(JSON.stringify(result).includes("private-session"), false);
  }));
});

test("native support notices accept only the first known enum", () => {
  assert.deepEqual(validateSupportSearch({
    support: ["submitted", "failed"],
    contact_email: "must-not-survive"
  }), { support: "submitted" });
  assert.deepEqual(validateSupportSearch({ support: "failed" }), {
    support: "failed"
  });
  assert.deepEqual(validateSupportSearch({ support: "private-upstream-code" }), {});
});
