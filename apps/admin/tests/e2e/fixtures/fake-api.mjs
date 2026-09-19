import http from "node:http";

const port = Number.parseInt(process.env.PORT ?? "18082", 10);
const reportID = "11111111-1111-4111-8111-111111111111";
const ticketID = "22222222-2222-4222-8222-222222222222";
const operatorID = "33333333-3333-4333-8333-333333333333";
const reporterID = "44444444-4444-4444-8444-444444444444";
const targetID = "55555555-5555-4555-8555-555555555555";
const sessionID = "66666666-6666-4666-8666-666666666666";
const createdAt = "2026-09-18T16:00:00Z";

const session = {
  user_id: operatorID,
  email: "operator@example.test",
  role: "site_admin",
  capabilities: [
    "admin.session.read",
    "reports.read",
    "reports.manage",
    "support.read",
    "support.manage",
    "audit.read",
  ],
  authenticated_at: "2026-09-18T15:30:00Z",
  absolute_expires_at: "2026-09-18T23:30:00Z",
};

const report = {
  id: reportID,
  reporter_user_id: reporterID,
  target_type: "user",
  target_id: targetID,
  reason: "<img src=x onerror=\"document.body.dataset.xss='report'\">",
  status: "open",
  resolution_note: "",
  retention_started_at: null,
  created_at: createdAt,
  updated_at: "2026-09-18T16:05:00Z",
};

const ticket = {
  id: ticketID,
  submitter_user_id: reporterID,
  contact_email: "player@example.test",
  name: "Player One",
  subject: '<script>document.body.dataset.xss="ticket"</script>',
  message:
    "<svg onload=\"document.body.dataset.xss='message'\"></svg> Help me recover my account.",
  status: "open",
  resolution_note: "",
  retention_started_at: null,
  created_at: "2026-09-18T16:10:00Z",
  updated_at: "2026-09-18T16:15:00Z",
};

const reportAudit = [];
const ticketAudit = [];
let sequence = 0;
let forcedConflict = false;

const server = http.createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  const requestURL = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "127.0.0.1"}`,
  );

  if (requestURL.pathname === "/health") {
    respond(response, 200, { service: "fake-admin-api", status: "ok" });
    return;
  }
  if (
    request.headers["x-cgn-admin-proxy-secret"] !==
    "browser-test-admin-proxy-secret-00000000"
  ) {
    respond(response, 403, { error: "admin_proxy_required" });
    return;
  }
  if (!String(request.headers.cookie ?? "").includes("cgn_admin_session=")) {
    respond(response, 401, { error: "admin_session_required" });
    return;
  }

  if (request.method === "GET" && requestURL.pathname === "/admin/v1/session") {
    respond(response, 200, session);
    return;
  }
  if (request.method === "GET" && requestURL.pathname === "/admin/v1/reports") {
    respond(response, 200, {
      reports: matchesFilters(report, requestURL)
        ? [
            {
              id: report.id,
              reporter_user_id: report.reporter_user_id,
              target_type: report.target_type,
              target_id: report.target_id,
              status: report.status,
              ...(report.assigned_to_user_id
                ? { assigned_to_user_id: report.assigned_to_user_id }
                : {}),
              retention_started_at: report.retention_started_at,
              created_at: report.created_at,
              updated_at: report.updated_at,
            },
          ]
        : [],
      next_cursor: "",
      previous_cursor: "",
    });
    return;
  }
  if (
    request.method === "GET" &&
    requestURL.pathname === `/admin/v1/reports/${reportID}`
  ) {
    respond(response, 200, report);
    return;
  }
  if (
    request.method === "GET" &&
    requestURL.pathname === `/admin/v1/reports/${reportID}/audit`
  ) {
    respond(response, 200, {
      audit_entries: reportAudit,
      next_cursor: "",
      previous_cursor: "",
    });
    return;
  }
  if (
    request.method === "PATCH" &&
    requestURL.pathname === `/admin/v1/reports/${reportID}`
  ) {
    await patchQueueItem(request, response, report, reportAudit, "report");
    return;
  }

  if (
    request.method === "GET" &&
    requestURL.pathname === "/admin/v1/support-tickets"
  ) {
    respond(response, 200, {
      support_tickets: matchesFilters(ticket, requestURL)
        ? [
            {
              id: ticket.id,
              submitter_user_id: ticket.submitter_user_id,
              subject: ticket.subject,
              status: ticket.status,
              ...(ticket.assigned_to_user_id
                ? { assigned_to_user_id: ticket.assigned_to_user_id }
                : {}),
              retention_started_at: ticket.retention_started_at,
              created_at: ticket.created_at,
              updated_at: ticket.updated_at,
            },
          ]
        : [],
      next_cursor: "",
      previous_cursor: "",
    });
    return;
  }
  if (
    request.method === "GET" &&
    requestURL.pathname === `/admin/v1/support-tickets/${ticketID}`
  ) {
    respond(response, 200, ticket);
    return;
  }
  if (
    request.method === "GET" &&
    requestURL.pathname === `/admin/v1/support-tickets/${ticketID}/audit`
  ) {
    respond(response, 200, {
      audit_entries: ticketAudit,
      next_cursor: "",
      previous_cursor: "",
    });
    return;
  }
  if (
    request.method === "PATCH" &&
    requestURL.pathname === `/admin/v1/support-tickets/${ticketID}`
  ) {
    await patchQueueItem(
      request,
      response,
      ticket,
      ticketAudit,
      "support_ticket",
    );
    return;
  }

  respond(response, 404, { error: "not_found" });
});

server.listen(port, "127.0.0.1");

function matchesFilters(item, requestURL) {
  const status = requestURL.searchParams.get("status");
  const assignee = requestURL.searchParams.get("assignee");
  return (
    (!status || item.status === status) &&
    (!assignee ||
      (assignee === "unassigned"
        ? !item.assigned_to_user_id
        : item.assigned_to_user_id === assignee))
  );
}

async function patchQueueItem(request, response, item, audit, entityType) {
  const cookies = String(request.headers.cookie ?? "");
  if (
    request.headers.origin !== "http://127.0.0.1:3202" ||
    request.headers["x-cgn-admin-csrf"] !== "csrf-token" ||
    !cookies.includes("cgn_admin_csrf=csrf-token")
  ) {
    respond(response, 403, { error: "admin_csrf_invalid" });
    return;
  }
  const body = JSON.parse(await readBody(request));
  if (
    entityType === "report" &&
    body.resolution_note === "Force conflict once" &&
    !forcedConflict
  ) {
    forcedConflict = true;
    item.status = "in_review";
    item.updated_at = "2026-09-18T16:20:00Z";
    respond(response, 409, { error: "queue_item_conflict" });
    return;
  }
  if (body.expected_updated_at !== item.updated_at) {
    respond(response, 409, { error: "queue_item_conflict" });
    return;
  }

  const before = queueState(item);
  item.status = body.status;
  if (body.assigned_to_user_id) {
    item.assigned_to_user_id = body.assigned_to_user_id;
  } else {
    delete item.assigned_to_user_id;
  }
  const noteChanged = item.resolution_note !== body.resolution_note;
  item.resolution_note = body.resolution_note;
  item.retention_started_at =
    body.status === "resolved" || body.status === "closed"
      ? (item.retention_started_at ?? "2026-09-18T16:25:00Z")
      : null;
  sequence += 1;
  item.updated_at = `2026-09-18T16:${String(25 + sequence).padStart(2, "0")}:00Z`;
  audit.unshift({
    id: `77777777-7777-4777-8777-${String(sequence).padStart(12, "0")}`,
    actor_user_id: operatorID,
    admin_session_id: sessionID,
    request_id: `browser-test-${sequence}`,
    action:
      entityType === "report" ? "report.updated" : "support_ticket.updated",
    entity_type: entityType,
    entity_id: item.id,
    before,
    after: queueState(item),
    metadata: { resolution_note_changed: noteChanged },
    created_at: item.updated_at,
  });
  respond(response, 200, item);
}

function queueState(item) {
  return {
    status: item.status,
    assigned_to_user_id: item.assigned_to_user_id ?? null,
    retention_started_at: item.retention_started_at,
  };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function respond(response, status, payload) {
  response.writeHead(status);
  response.end(JSON.stringify(payload));
}
