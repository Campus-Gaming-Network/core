import { Link, useHydrated, useNavigate } from "@tanstack/react-router";
import { Lock, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import { filterFormSearch } from "./directory-filters";

type DirectoryPath = "/events" | "/teams" | "/schools";

// The directories share one link shape; the router types each route's search
// separately, so the filter links go through this looser view.
const DirectoryLink = Link as unknown as ComponentType<{
  to: DirectoryPath;
  search: Record<string, string>;
  activeOptions: { exact: boolean };
  className?: string;
  children: ReactNode;
}>;

// Clear filters links to a wider list than the current one, so it must not
// read as the current page just because its query is a subset.
const exactMatch = { exact: true };

/**
 * A directory's filter form. Without JavaScript it is a plain GET form that
 * its Apply button submits. With JavaScript, changing a select or checkbox
 * navigates at once with the router, and so does a submit (Enter in a search
 * box, or the school filter choosing a school); page cursors drop because
 * they are not form fields. Focus returns to the control that applied the
 * change once the form remounts for the new query. `formKey` makes Back
 * restore the controls from the URL.
 */
export function FilterForm({
  action,
  children,
  className,
  formKey,
}: {
  action: DirectoryPath;
  children: ReactNode;
  className?: string;
  formKey: string;
}) {
  const navigate = useNavigate();
  const hydrated = useHydrated();
  const formRef = useRef<HTMLFormElement>(null);
  // The control that applied the change, by its `data-refocus` key or its
  // name: ids generated on the client differ after the form remounts.
  const refocus = useRef<string | undefined>(undefined);

  useEffect(() => {
    const key = refocus.current;
    refocus.current = undefined;
    const form = formRef.current;
    if (!key || !form) return;
    const control =
      form.querySelector(`[data-refocus="${CSS.escape(key)}"]`) ??
      form.querySelector(`[name="${CSS.escape(key)}"]:not([type="hidden"])`);
    if (control instanceof HTMLElement) control.focus();
  }, [formKey]);

  function apply(form: HTMLFormElement) {
    const active = document.activeElement;
    refocus.current =
      active instanceof HTMLElement && form.contains(active)
        ? (active.dataset.refocus ?? active.getAttribute("name") ?? undefined)
        : undefined;
    const search = filterFormSearch(new FormData(form).entries());
    void navigate({ to: action, search: search as never });
  }

  function applyChange(event: FormEvent<HTMLFormElement>) {
    const target = event.target;
    const applies =
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLInputElement &&
        (target.type === "checkbox" || target.type === "date"));
    if (applies) apply(event.currentTarget);
  }

  function applySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply(event.currentTarget);
  }

  return (
    <form
      action={action}
      className={className}
      key={formKey}
      method="get"
      onChange={hydrated ? applyChange : undefined}
      onSubmit={hydrated ? applySubmit : undefined}
      ref={formRef}
    >
      {children}
    </form>
  );
}

/**
 * Clears the filters: a plain link back to the directory, keeping only what
 * `search` holds (such as the events tab's own filter).
 */
export function ClearFiltersLink({
  search = {},
  to,
}: {
  search?: Record<string, string>;
  to: DirectoryPath;
}) {
  return (
    <DirectoryLink
      activeOptions={exactMatch}
      className="filter-toolbar__clear"
      search={search}
      to={to}
    >
      <X aria-hidden="true" size={14} strokeWidth={2} />
      Clear filters
    </DirectoryLink>
  );
}

/** A polite live region that announces the result count after a filter changes. */
export function ResultsAnnouncement({ message }: { message: string }) {
  return (
    <p aria-live="polite" className="visually-hidden" role="status">
      {message}
    </p>
  );
}

/**
 * The filters over a directory's results: an optional search field (a school
 * search, or the schools page's name search), then a row of compact filter
 * buttons that each show their current value, and Clear filters while any is
 * applied. Wrap it in `FilterForm`. Without JavaScript, `Apply filters`
 * submits it; with JavaScript each control applies as it changes and the
 * button is hidden. Styles live in components.css.
 */
export function FilterToolbar({
  children,
  clear,
  label,
  search,
}: {
  /** The filter buttons. */
  children?: ReactNode;
  /** `ClearFiltersLink`, while any filter is applied. */
  clear?: ReactNode;
  /** Names the group of filter buttons, such as "Event filters". */
  label: string;
  search?: ReactNode;
}) {
  return (
    <div className="filter-toolbar">
      {search ? <div className="filter-toolbar__search">{search}</div> : null}
      <div aria-label={label} className="filter-toolbar__filters" role="group">
        {children}
        {clear}
        <button className="filter-toolbar__apply" type="submit">
          Apply filters
        </button>
      </div>
    </div>
  );
}

/**
 * One filter as a compact native select: the filter's name, then its value
 * ("Game  Any"). It is highlighted while a value other than Any is applied.
 * Clicking the name opens the list where the browser allows it.
 */
export function FilterSelect({
  anyLabel = "Any",
  disabled,
  label,
  name,
  options,
  value,
}: {
  /** The text of the option that applies no filter. */
  anyLabel?: string;
  disabled?: boolean;
  label: string;
  name: string;
  options: { value: string; label: string }[];
  value?: string;
}) {
  const id = useId();
  return (
    <label
      className="filter-pill"
      data-active={value ? "" : undefined}
      htmlFor={id}
      onClick={(event) => {
        // A label click only focuses a select; open its list as well.
        const select = event.currentTarget.querySelector("select");
        if (!select || event.target === select) return;
        try {
          select.showPicker();
        } catch {
          // Older browsers focus the select, which is enough.
        }
      }}
    >
      <span className="filter-pill__name">{label}</span>
      <select
        defaultValue={value ?? ""}
        disabled={disabled}
        id={id}
        name={name}
      >
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** A yes-or-no filter as a button with a checkbox, such as "Free only". */
/**
 * A date filter as a compact native date field: the filter's name, then the
 * date. Highlighted while a date is set; clearing the date removes it.
 */
export function FilterDate({
  label,
  max,
  min,
  name,
  value,
}: {
  label: string;
  max?: string;
  min?: string;
  name: string;
  value?: string;
}) {
  const id = useId();
  return (
    <label
      className="filter-pill filter-pill--date"
      data-active={value ? "" : undefined}
      htmlFor={id}
    >
      <span className="filter-pill__name">{label}</span>
      <input
        defaultValue={value ?? ""}
        id={id}
        max={max}
        min={min}
        name={name}
        type="date"
      />
    </label>
  );
}

export function FilterToggle({
  checked,
  label,
  name,
  value,
}: {
  checked: boolean;
  label: string;
  name: string;
  value: string;
}) {
  const id = useId();
  return (
    <label
      className="filter-pill filter-pill--toggle"
      data-active={checked ? "" : undefined}
      htmlFor={id}
    >
      <input
        defaultChecked={checked}
        id={id}
        name={name}
        type="checkbox"
        value={value}
      />
      {label}
    </label>
  );
}

/**
 * A filter another control has set, such as the Online tab's format: shown
 * with a lock and kept in the form, but not changeable here.
 */
export function LockedFilter({
  label,
  name,
  reason,
  value,
  valueLabel,
}: {
  label: string;
  name: string;
  /** Why it is locked, read after the value: "set by the Online tab". */
  reason: string;
  value: string;
  valueLabel: string;
}) {
  return (
    <span
      className="filter-pill filter-pill--locked"
      title={`Set by ${reason}`}
    >
      <Lock aria-hidden="true" size={14} strokeWidth={2} />
      <span className="filter-pill__name">{label}</span>
      <span className="filter-pill__value">{valueLabel}</span>
      <span className="visually-hidden">, set by {reason}</span>
      <input name={name} type="hidden" value={value} />
    </span>
  );
}

/**
 * Without JavaScript, the search filters cannot search as you type, so this
 * GET form above the toolbar does it: each field reloads the page with its
 * `*_q` parameter, and the matches fill the filter's select. `preserve`
 * carries the page's other filters through the search.
 */
export function NoScriptFilterSearch({
  action,
  fields,
  preserve,
}: {
  action: DirectoryPath;
  fields: { label: string; name: string; query?: string }[];
  preserve: Record<string, string | undefined>;
}) {
  return (
    <noscript>
      <form action={action} className="search-bar compact" method="get">
        {Object.entries(preserve).map(([name, value]) =>
          value ? (
            <input key={name} name={name} type="hidden" value={value} />
          ) : null,
        )}
        {fields.map((field) => (
          <label key={field.name}>
            {field.label}
            <input
              defaultValue={field.query ?? ""}
              name={field.name}
              placeholder="Type a name"
              type="search"
            />
          </label>
        ))}
        <button type="submit">Search</button>
      </form>
    </noscript>
  );
}
