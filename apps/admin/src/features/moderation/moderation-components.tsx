import { UserLink } from "../../components/user-link";
import { useRouteContext, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent, type ReactNode } from "react";
import { updateQueueItem } from "./moderation.functions";
import type {
  AuditPage,
  ModerationDetailSearch,
  ModerationFieldErrors,
  Operator,
  QueueMutationResult,
  QueueSearch,
  QueueStatus,
  Report,
  SupportTicket,
} from "./contracts";

const statusLabels: Record<QueueStatus, string> = {
  open: "Open",
  in_review: "In review",
  resolved: "Resolved",
  closed: "Closed",
};

export function QueueFilters({
  action,
  operators,
  search,
}: {
  action: "/reports" | "/support-tickets";
  operators: Operator[];
  search: QueueSearch;
}) {
  const userLabel = action === "/reports" ? "Reporter" : "Submitter";

  return (
    <form action={action} className="filter-panel" method="get">
      <label>
        Status
        <select defaultValue={search.status ?? "open"} name="status">
          <option value="all">All statuses</option>
          {Object.entries(statusLabels).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {action === "/reports" ? (
        <label>
          Type
          <select defaultValue={search.type ?? ""} name="type">
            <option value="">All types</option>
            <option value="event">Event</option>
            <option value="user">User</option>
          </select>
        </label>
      ) : null}
      <label>
        Assignee
        <select defaultValue={search.assignee ?? ""} name="assignee">
          <option value="">Anyone</option>
          <option value="unassigned">Unassigned</option>
          {assigneeOptions(operators, search.assignee).map((operator) => (
            <option key={operator.id} value={operator.id}>
              {operator.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        {userLabel} (name or email)
        <input
          defaultValue={search.user ?? ""}
          name="user"
          placeholder={`Find by ${userLabel.toLowerCase()}`}
          spellCheck={false}
        />
      </label>
      <div className="filter-actions">
        <button type="submit">Apply filters</button>
        <a className="secondary-button" href={action}>
          Clear
        </a>
      </div>
    </form>
  );
}

export function QueuePagination({
  path,
  search,
  previousCursor,
  nextCursor,
}: {
  path: "/reports" | "/support-tickets";
  search: QueueSearch;
  previousCursor: string;
  nextCursor: string;
}) {
  return (
    <nav className="pagination" aria-label="Queue pages">
      {previousCursor ? (
        <a href={queuePageURL(path, search, "before", previousCursor)}>
          Previous
        </a>
      ) : (
        <span />
      )}
      {nextCursor ? (
        <a href={queuePageURL(path, search, "after", nextCursor)}>Next</a>
      ) : (
        <span />
      )}
    </nav>
  );
}

export function QueueStatusBadge({ status }: { status: QueueStatus }) {
  return (
    <span className={`queue-status queue-status--${status}`}>
      {statusLabels[status]}
    </span>
  );
}

export function DetailNotice({ notice }: { notice?: string }) {
  if (!notice) return null;
  const failed = notice === "update-failed" || notice === "conflict";
  const message =
    notice === "updated"
      ? "Changes saved."
      : notice === "conflict"
        ? "This item changed before your update was saved. Review the current values and try again."
        : "The update could not be saved. Review the fields and try again.";
  return (
    <p
      className={`notice ${failed ? "notice--error" : "notice--success"}`}
      role={failed ? "alert" : "status"}
    >
      {message}
    </p>
  );
}

export function QueueMutationForm({
  kind,
  item,
  operators,
}: {
  kind: "report" | "support-ticket";
  item: Report | SupportTicket;
  operators: Operator[];
}) {
  const runUpdate = useServerFn(updateQueueItem);
  const currentUserID = useRouteContext({
    strict: false,
    select: (context) =>
      context.admin?.status === "authenticated"
        ? context.admin.session.user_id
        : undefined,
  });
  const [assignee, setAssignee] = useState(item.assigned_to_user_id ?? "");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    fieldErrors: ModerationFieldErrors;
  }>({ message: "", fieldErrors: {} });
  const [conflict, setConflict] = useState<Report | SupportTicket>();
  const [expectedUpdatedAt, setExpectedUpdatedAt] = useState(item.updated_at);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setFeedback({ message: "", fieldErrors: {} });
    setConflict(undefined);
    const data = new FormData(event.currentTarget);
    data.set("expected_updated_at", expectedUpdatedAt);

    try {
      const result: QueueMutationResult = await runUpdate({ data });
      if (result.status === "success") {
        await router.invalidate();
        await router.navigate({ href: result.redirectTo, replace: true });
        return;
      }
      if (result.status === "conflict") {
        setConflict(result.current);
        setExpectedUpdatedAt(result.current.updated_at);
        setFeedback({ message: result.message, fieldErrors: {} });
        return;
      }
      setFeedback({
        message: result.message,
        fieldErrors: result.fieldErrors ?? {},
      });
    } catch {
      setFeedback({
        message: "The update could not be saved. Try again.",
        fieldErrors: {},
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="detail-panel" aria-labelledby="workflow-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Workflow</p>
          <h2 id="workflow-heading">Review and assignment</h2>
        </div>
      </div>

      {feedback.message ? (
        <p className="notice notice--error" role="alert" aria-live="polite">
          {feedback.message}
        </p>
      ) : null}
      {conflict ? <ConflictState item={conflict} /> : null}

      <form
        action={updateQueueItem.url}
        className="moderation-form"
        method="post"
        onSubmit={submit}
      >
        <input name="kind" type="hidden" value={kind} />
        <input name="id" type="hidden" value={item.id} />
        <input
          name="expected_updated_at"
          type="hidden"
          value={expectedUpdatedAt}
        />
        <div className="form-grid">
          <label>
            Status
            <select name="status" defaultValue={item.status} required>
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <select
              aria-describedby={
                feedback.fieldErrors.assigned_to_user_id
                  ? "assigned-to-error"
                  : undefined
              }
              aria-invalid={
                Boolean(feedback.fieldErrors.assigned_to_user_id) || undefined
              }
              name="assigned_to_user_id"
              onChange={(event) => setAssignee(event.target.value)}
              value={assignee}
            >
              <option value="">Unassigned</option>
              {assigneeOptions(operators, item.assigned_to_user_id, {
                id: item.assigned_to_user_id,
                name: item.assigned_to_name,
              }).map((operator) => (
                <option key={operator.id} value={operator.id}>
                  {operator.name}
                </option>
              ))}
            </select>
            {currentUserID &&
            assignee !== currentUserID &&
            operators.some((operator) => operator.id === currentUserID) ? (
              <button
                className="text-button assign-to-me"
                onClick={() => setAssignee(currentUserID)}
                type="button"
              >
                Assign to me
              </button>
            ) : null}
            <FieldError
              id="assigned-to-error"
              messages={feedback.fieldErrors.assigned_to_user_id}
            />
          </label>
        </div>
        <label>
          Resolution note
          <textarea
            aria-describedby={
              feedback.fieldErrors.resolution_note
                ? "resolution-note-help resolution-note-error"
                : "resolution-note-help"
            }
            aria-invalid={
              Boolean(feedback.fieldErrors.resolution_note) || undefined
            }
            defaultValue={item.resolution_note}
            maxLength={5000}
            name="resolution_note"
            rows={6}
          />
          <span className="field-help" id="resolution-note-help">
            Visible to authorized operators. Audit history records only whether
            this note changed.
          </span>
          <FieldError
            id="resolution-note-error"
            messages={feedback.fieldErrors.resolution_note}
          />
        </label>
        <button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save changes"}
        </button>
      </form>
    </section>
  );
}

export function AuditPanel({
  audit,
  path,
  search,
}: {
  audit: AuditPage;
  path: string;
  search: ModerationDetailSearch;
}) {
  return (
    <section className="detail-panel" aria-labelledby="audit-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">History</p>
          <h2 id="audit-heading">Audit trail</h2>
        </div>
      </div>
      {audit.audit_entries.length ? (
        <ol className="audit-list">
          {audit.audit_entries.map((entry) => (
            <li key={entry.id}>
              <div className="audit-marker" aria-hidden="true" />
              <div>
                <div className="audit-title">
                  <strong>{auditActionLabel(entry.action)}</strong>
                  <time dateTime={entry.created_at}>
                    {formatTimestamp(entry.created_at)}
                  </time>
                </div>
                <p>
                  <QueueStatusBadge status={entry.before.status} />
                  <span aria-hidden="true"> → </span>
                  <span className="sr-only">changed to</span>
                  <QueueStatusBadge status={entry.after.status} />
                </p>
                <p className="audit-meta">
                  Actor{" "}
                  <UserLink
                    fallback="System"
                    name={entry.actor_name}
                    userId={entry.actor_user_id}
                  />
                  {entry.metadata.resolution_note_changed
                    ? " · Resolution note changed"
                    : ""}
                </p>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="empty-copy">No administrative changes recorded yet.</p>
      )}
      <nav className="pagination" aria-label="Audit history pages">
        {audit.previous_cursor ? (
          <a
            href={auditPageURL(
              path,
              search,
              "audit_before",
              audit.previous_cursor,
            )}
          >
            Newer
          </a>
        ) : (
          <span />
        )}
        {audit.next_cursor ? (
          <a
            href={auditPageURL(path, search, "audit_after", audit.next_cursor)}
          >
            Older
          </a>
        ) : (
          <span />
        )}
      </nav>
    </section>
  );
}

export function DetailFact({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

function ConflictState({ item }: { item: Report | SupportTicket }) {
  return (
    <aside className="conflict-panel" aria-labelledby="conflict-heading">
      <h3 id="conflict-heading">Current saved state</h3>
      <dl>
        <DetailFact label="Status">
          <QueueStatusBadge status={item.status} />
        </DetailFact>
        <DetailFact label="Assignee">
          <UserLink
            fallback="Unassigned"
            name={item.assigned_to_name}
            userId={item.assigned_to_user_id}
          />
        </DetailFact>
        <DetailFact label="Last changed">
          <time dateTime={item.updated_at}>
            {formatTimestamp(item.updated_at)}
          </time>
        </DetailFact>
      </dl>
    </aside>
  );
}

export function FieldError({
  id,
  messages,
}: {
  id: string;
  messages?: string[];
}) {
  if (!messages?.length) return null;
  return (
    <span className="form-error" id={id}>
      {messages.join(" ")}
    </span>
  );
}

function queuePageURL(
  path: string,
  search: QueueSearch,
  direction: "after" | "before",
  cursor: string,
): string {
  const query = new URLSearchParams();
  if (search.status) query.set("status", search.status);
  if (search.type) query.set("type", search.type);
  if (search.assignee) query.set("assignee", search.assignee);
  if (search.user) query.set("user", search.user);
  query.set(direction, cursor);
  return `${path}?${query.toString()}`;
}

function auditPageURL(
  path: string,
  search: ModerationDetailSearch,
  direction: "audit_after" | "audit_before",
  cursor: string,
): string {
  const query = new URLSearchParams();
  if (search.notice) query.set("notice", search.notice);
  query.set(direction, cursor);
  return `${path}?${query.toString()}`;
}

function auditActionLabel(action: string): string {
  return action === "report.updated"
    ? "Report updated"
    : "Support ticket updated";
}

/**
 * The operators to offer, plus the currently selected user when they are not
 * an active site admin, so an existing choice is never silently dropped.
 */
function assigneeOptions(
  operators: Operator[],
  selectedID: string | undefined,
  selected?: { id: string | undefined; name: string | undefined },
): Operator[] {
  if (
    !selectedID ||
    selectedID === "unassigned" ||
    operators.some((operator) => operator.id === selectedID)
  ) {
    return operators;
  }
  return [
    ...operators,
    { id: selectedID, name: selected?.name ?? "Former operator" },
  ];
}
