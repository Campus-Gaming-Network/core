import { useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState, type FormEvent, type ReactNode } from "react";
import {
  FieldError,
  formatTimestamp,
} from "../moderation/moderation-components";
import {
  catalogCommands,
  catalogNotices,
  type AdminGame,
  type AdminSchool,
  type CatalogAuditEntry,
  type CatalogAuditPage,
  type CatalogCommandName,
  type CatalogDetailSearch,
  type CatalogFieldErrors,
  type CatalogMutationResult,
  type CatalogNotice,
  type CatalogSearch,
} from "./contracts";
import { runCatalogCommand, saveGame, saveSchool } from "./catalog.functions";

export function CatalogNoticeView({ notice }: { notice?: CatalogNotice }) {
  if (!notice) return null;
  const { message, severity } = catalogNotices[notice];
  return (
    <p
      className={`notice ${severity === "danger" ? "notice--error" : "notice--success"}`}
      role={severity === "danger" ? "alert" : "status"}
    >
      {message}
    </p>
  );
}

export function CatalogFilters({
  action,
  label,
  search,
  states,
}: {
  action: string;
  label: string;
  search: CatalogSearch;
  states: readonly string[];
}) {
  return (
    <form action={action} className="filter-panel" method="get">
      <label>
        State
        <select defaultValue={search.state ?? ""} name="state">
          <option value="">All states</option>
          {states.map((state) => (
            <option key={state} value={state}>
              {stateLabel(state)}
            </option>
          ))}
        </select>
      </label>
      <label>
        {label}
        <input
          defaultValue={search.q ?? ""}
          maxLength={100}
          minLength={2}
          name="q"
          spellCheck={false}
          type="search"
        />
      </label>
      <div className="filter-actions">
        <button type="submit">Search</button>
        <a className="secondary-button" href={action}>
          Clear
        </a>
      </div>
    </form>
  );
}

export function CursorPagination({
  label,
  path,
  search,
  previousCursor,
  nextCursor,
}: {
  label: string;
  path: string;
  search: CatalogSearch;
  previousCursor: string;
  nextCursor: string;
}) {
  function pageURL(direction: "after" | "before", cursor: string) {
    const query = new URLSearchParams();
    if (search.q) query.set("q", search.q);
    if (search.state) query.set("state", search.state);
    query.set(direction, cursor);
    return `${path}?${query.toString()}`;
  }
  return (
    <nav className="pagination" aria-label={label}>
      {previousCursor ? (
        <a href={pageURL("before", previousCursor)}>Previous</a>
      ) : (
        <span />
      )}
      {nextCursor ? <a href={pageURL("after", nextCursor)}>Next</a> : <span />}
    </nav>
  );
}

export function StateBadge({ state }: { state: string }) {
  return (
    <span className={`queue-status record-state--${state}`}>
      {stateLabel(state)}
    </span>
  );
}

export function recordState(record: {
  deleted_at: string | null;
  is_active: boolean;
}): "active" | "inactive" | "deleted" {
  return record.deleted_at
    ? "deleted"
    : record.is_active
      ? "active"
      : "inactive";
}

// Enhanced submission for catalog forms. A stale write keeps the operator's
// entries, advances the version so a reviewed retry can proceed, and reloads
// the page's read-only facts. An ended session reloads the shell, which then
// shows the access boundary instead of protected content.
function useCatalogSubmit(
  run: (options: { data: FormData }) => Promise<CatalogMutationResult>,
  initialVersion: string,
) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [version, setVersion] = useState(initialVersion);
  // Follow the record version the page shows. A save reloads the page with a
  // new version; a stale-write response advances it explicitly below.
  const [pageVersion, setPageVersion] = useState(initialVersion);
  if (pageVersion !== initialVersion) {
    setPageVersion(initialVersion);
    setVersion(initialVersion);
  }
  const [feedback, setFeedback] = useState<{
    message: string;
    fieldErrors: CatalogFieldErrors;
  }>({ message: "", fieldErrors: {} });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setFeedback({ message: "", fieldErrors: {} });
    const data = new FormData(form);
    if (version) data.set("expected_updated_at", version);
    try {
      const result = await run({ data });
      if (result.status === "success" || result.status === "step-up-required") {
        await router.invalidate();
        await router.navigate({
          href: result.redirectTo,
          replace: result.status === "success",
        });
        // Clear the reason and confirmation, and show the saved values,
        // so a finished action cannot be resubmitted by accident.
        form.reset();
        return;
      }
      if (result.status === "session-ended") {
        await router.invalidate();
        return;
      }
      setFeedback({
        message: result.message,
        fieldErrors: result.fieldErrors ?? {},
      });
      if (result.currentUpdatedAt) {
        setVersion(result.currentUpdatedAt);
        await router.invalidate();
      }
    } catch {
      setFeedback({
        message: "The change could not be saved. Try again.",
        fieldErrors: {},
      });
    } finally {
      setPending(false);
    }
  }

  return { submit, pending, version, feedback };
}

export function SchoolForm({ school }: { school?: AdminSchool }) {
  const runSave = useServerFn(saveSchool);
  const { submit, pending, version, feedback } = useCatalogSubmit(
    runSave,
    school?.updated_at ?? "",
  );
  const errors = feedback.fieldErrors;

  return (
    <form
      action={saveSchool.url}
      className="moderation-form"
      method="post"
      onSubmit={submit}
    >
      <FormFeedback message={feedback.message} />
      <input name="id" type="hidden" value={school?.id ?? ""} />
      <input name="expected_updated_at" type="hidden" value={version} />
      <div className="form-grid">
        <TextField
          errors={errors.name}
          label="Name"
          name="name"
          required
          value={school?.name}
          maxLength={300}
        />
        <TextField
          errors={errors.slug}
          help="Lowercase letters, numbers, and single hyphens."
          label="Slug"
          name="slug"
          required
          value={school?.slug}
          maxLength={120}
        />
        <TextField
          errors={errors.alias}
          label="Alias"
          name="alias"
          value={school?.alias}
          maxLength={300}
        />
        <TextField
          errors={errors.unitid}
          help="The IPEDS unit ID, when the school has one."
          inputMode="numeric"
          label="Unit ID"
          name="unitid"
          value={school?.unitid?.toString()}
        />
        <TextField
          errors={errors.city}
          label="City"
          name="city"
          value={school?.city}
          maxLength={100}
        />
        <TextField
          errors={errors.state}
          label="State"
          name="state"
          value={school?.state}
          maxLength={80}
        />
        <TextField
          errors={errors.zip}
          label="ZIP code"
          name="zip"
          value={school?.zip}
          maxLength={20}
        />
        <TextField
          errors={errors.website_url}
          label="Website"
          name="website_url"
          type="url"
          value={school?.website_url}
          maxLength={2048}
        />
        <TextField
          errors={errors.latitude}
          inputMode="decimal"
          label="Latitude"
          name="latitude"
          value={school?.latitude?.toString()}
        />
        <TextField
          errors={errors.longitude}
          inputMode="decimal"
          label="Longitude"
          name="longitude"
          value={school?.longitude?.toString()}
        />
        <TextField
          errors={errors.num_branches}
          inputMode="numeric"
          label="Branch campuses"
          name="num_branches"
          value={(school?.num_branches ?? 0).toString()}
        />
        <label className="checkbox-field">
          <input
            defaultChecked={school?.is_main_campus ?? true}
            name="is_main_campus"
            type="checkbox"
          />
          Main campus
        </label>
      </div>
      <ReasonField errors={errors.reason} />
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : school ? "Save school" : "Create school"}
      </button>
    </form>
  );
}

export function GameForm({ game }: { game?: AdminGame }) {
  const runSave = useServerFn(saveGame);
  const { submit, pending, version, feedback } = useCatalogSubmit(
    runSave,
    game?.updated_at ?? "",
  );
  const errors = feedback.fieldErrors;

  return (
    <form
      action={saveGame.url}
      className="moderation-form"
      method="post"
      onSubmit={submit}
    >
      <FormFeedback message={feedback.message} />
      <input name="id" type="hidden" value={game?.id ?? ""} />
      <input name="expected_updated_at" type="hidden" value={version} />
      <div className="form-grid">
        <TextField
          errors={errors.name}
          label="Name"
          name="name"
          required
          value={game?.name}
          maxLength={200}
        />
        <TextField
          errors={errors.slug}
          help="Lowercase letters, numbers, and single hyphens."
          label="Slug"
          name="slug"
          required
          value={game?.slug}
          maxLength={120}
        />
        <TextField
          errors={errors.cover_url}
          label="Cover image URL"
          name="cover_url"
          type="url"
          value={game?.cover_url}
          maxLength={2048}
        />
        <label className="checkbox-field">
          <input
            defaultChecked={game?.is_active ?? true}
            name="is_active"
            type="checkbox"
          />
          Shown in the public game picker
        </label>
      </div>
      <ReasonField errors={errors.reason} />
      <button type="submit" disabled={pending}>
        {pending ? "Saving…" : game ? "Save game" : "Create game"}
      </button>
    </form>
  );
}

/**
 * One named operation with its audit reason. Destructive commands add an
 * explicit confirmation; step-up commands send the operator to confirm their
 * identity first when their last step-up is no longer recent.
 */
export function CommandForm({
  command,
  id,
  expectedUpdatedAt,
  title,
  description,
  submitLabel,
  returnPath,
  stepUpReady,
  hiddenFields,
  children,
}: {
  command: CatalogCommandName;
  id: string;
  expectedUpdatedAt?: string;
  title: string;
  description: string;
  submitLabel: string;
  returnPath: string;
  stepUpReady?: boolean;
  hiddenFields?: Record<string, string>;
  children?: ReactNode;
}) {
  const runCommand = useServerFn(runCatalogCommand);
  const { submit, pending, version, feedback } = useCatalogSubmit(
    runCommand,
    expectedUpdatedAt ?? "",
  );
  const policy = catalogCommands[command];
  // Several forms for one command can share a page, such as one revoke form
  // per grant, so the target's hidden identifiers keep element IDs unique.
  const target = Object.values(hiddenFields ?? {}).join("-") || id;
  const headingID = `${command.replace(/[._]/g, "-")}-${target}`;

  return (
    <section className="command-panel" aria-labelledby={headingID}>
      <h3 id={headingID}>{title}</h3>
      <p className="field-help">{description}</p>
      {policy.stepUp && !stepUpReady ? (
        <p className="notice">
          This action needs a recent identity confirmation.{" "}
          <a href={`/step-up?return=${encodeURIComponent(returnPath)}`}>
            Confirm your identity
          </a>{" "}
          and you will return here.
        </p>
      ) : (
        <form
          action={runCatalogCommand.url}
          className="moderation-form"
          method="post"
          onSubmit={submit}
        >
          <FormFeedback message={feedback.message} />
          <input name="command" type="hidden" value={command} />
          <input name="id" type="hidden" value={id} />
          <input name="expected_updated_at" type="hidden" value={version} />
          {Object.entries(hiddenFields ?? {}).map(([name, value]) => (
            <input key={name} name={name} type="hidden" value={value} />
          ))}
          {children}
          <FieldError
            id={`${headingID}-user`}
            messages={feedback.fieldErrors.user_id}
          />
          <ReasonField
            errors={feedback.fieldErrors.reason}
            idPrefix={headingID}
          />
          {policy.confirm ? (
            <label className="checkbox-field">
              <input name="confirmed" required type="checkbox" />
              I understand this change takes effect immediately.
            </label>
          ) : null}
          <FieldError
            id={`${headingID}-confirmed`}
            messages={feedback.fieldErrors.confirmed}
          />
          <button
            className={policy.confirm ? "danger-button" : undefined}
            type="submit"
            disabled={pending}
          >
            {pending ? "Saving…" : submitLabel}
          </button>
        </form>
      )}
    </section>
  );
}

export function CatalogAuditPanel({
  audit,
  path,
  search,
}: {
  audit: CatalogAuditPage;
  path: string;
  search: CatalogDetailSearch;
}) {
  function pageURL(direction: "audit_after" | "audit_before", cursor: string) {
    const query = new URLSearchParams();
    if (search.notice) query.set("notice", search.notice);
    query.set(direction, cursor);
    return `${path}?${query.toString()}`;
  }
  return (
    <section className="detail-panel" aria-labelledby="audit-heading">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Append-only history</p>
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
                  <strong>{auditActionLabels[entry.action]}</strong>
                  <time dateTime={entry.created_at}>
                    {formatTimestamp(entry.created_at)}
                  </time>
                </div>
                {entry.reason ? (
                  <p className="stored-content">{entry.reason}</p>
                ) : null}
                <p className="audit-meta">
                  Actor <code>{entry.actor_user_id ?? "system"}</code>
                  {entry.changed_fields.length
                    ? ` · Changed ${entry.changed_fields
                        .map((field) => field.replaceAll("_", " "))
                        .join(", ")}`
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
          <a href={pageURL("audit_before", audit.previous_cursor)}>Newer</a>
        ) : (
          <span />
        )}
        {audit.next_cursor ? (
          <a href={pageURL("audit_after", audit.next_cursor)}>Older</a>
        ) : (
          <span />
        )}
      </nav>
    </section>
  );
}

const auditActionLabels: Record<CatalogAuditEntry["action"], string> = {
  "school.created": "School created",
  "school.updated": "School updated",
  "school.deactivated": "School deactivated",
  "school.reactivated": "School reactivated",
  "school.deleted": "School deleted",
  "school_admin.granted": "School-admin access granted",
  "school_admin.revoked": "School-admin access revoked",
  "game.created": "Game created",
  "game.updated": "Game updated",
  "game.deleted": "Game deleted",
  "user.suspended": "Account suspended",
  "user.reactivated": "Account reactivated",
  "user.trust_changed": "Trust level changed",
  "site_role_grant.bootstrapped": "First site admin bootstrapped",
  "site_role_grant.granted": "Site-admin access granted",
  "site_role_grant.revoked": "Site-admin access revoked",
};

function stateLabel(state: string): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

function FormFeedback({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p className="notice notice--error" role="alert" aria-live="polite">
      {message}
    </p>
  );
}

function ReasonField({
  errors,
  idPrefix = "record",
}: {
  errors?: string[];
  idPrefix?: string;
}) {
  const errorID = `${idPrefix}-reason-error`;
  return (
    <label>
      Reason
      <textarea
        aria-describedby={errors?.length ? errorID : undefined}
        aria-invalid={errors?.length ? true : undefined}
        maxLength={1000}
        name="reason"
        required
        rows={3}
      />
      <span className="field-help">Recorded in the audit trail.</span>
      <FieldError id={errorID} messages={errors} />
    </label>
  );
}

function TextField({
  label,
  name,
  value,
  errors,
  help,
  ...input
}: {
  label: string;
  name: string;
  value?: string;
  errors?: string[];
  help?: string;
  required?: boolean;
  maxLength?: number;
  type?: "url";
  inputMode?: "numeric" | "decimal";
}) {
  const errorID = `${name}-error`;
  return (
    <label>
      {label}
      <input
        aria-describedby={errors?.length ? errorID : undefined}
        aria-invalid={errors?.length ? true : undefined}
        defaultValue={value ?? ""}
        name={name}
        spellCheck={false}
        {...input}
      />
      {help ? <span className="field-help">{help}</span> : null}
      <FieldError id={errorID} messages={errors} />
    </label>
  );
}
