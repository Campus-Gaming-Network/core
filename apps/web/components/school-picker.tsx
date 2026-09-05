"use client";

import { Button } from "@heroui/react/button";
import { ComboBox } from "@heroui/react/combo-box";
import { Input } from "@heroui/react/input";
import { Label } from "@heroui/react/label";
import { ListBox } from "@heroui/react/list-box";
import {
  useEffect,
  useId,
  useMemo,
  useState
} from "react";
import {
  hydrateSchoolPickerSelection,
  isSchoolSearchResponse,
  mergeSchoolPickerOptions,
  schoolPickerOptionLabel,
  schoolSearchStatusMessage,
  type SchoolPickerOption,
  type SchoolSearchStatus
} from "../lib/school-picker-model";

const searchDelayMilliseconds = 250;

type SchoolPickerProps = {
  name: string;
  label: string;
  initialSchools?: SchoolPickerOption[];
  initialQuery?: string;
  initialSearchFailed?: boolean;
  selectedSchool?: SchoolPickerOption;
  selectedSchoolID?: string;
  isRequired?: boolean;
  emptyLabel?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export function SchoolPicker({
  name,
  label,
  initialSchools = [],
  initialQuery = "",
  initialSearchFailed = false,
  selectedSchool: selectedSchoolProp,
  selectedSchoolID,
  isRequired = false,
  emptyLabel = "No school selected",
  "aria-describedby": describedBy,
  "aria-invalid": isInvalid
}: SchoolPickerProps) {
  const statusID = useId();
  const [isEnhanced, setIsEnhanced] = useState(false);
  const [selectedSchool, setSelectedSchool] = useState(() =>
    hydrateSchoolPickerSelection(
      selectedSchoolID,
      selectedSchoolProp,
      initialSchools
    )
  );
  const [retainedSchool, setRetainedSchool] = useState(selectedSchool);
  const [inputValue, setInputValue] = useState(() =>
    initialQuery.trim().length > 0
      ? initialQuery
      : selectedSchool
      ? schoolPickerOptionLabel(selectedSchool)
      : ""
  );
  const [results, setResults] = useState(initialSchools);
  const [status, setStatus] = useState<SchoolSearchStatus>(
    initialSearchFailed ? "error" : initialQuery.trim().length >= 2 ? "success" : "idle"
  );
  const [retryCount, setRetryCount] = useState(0);
  const options = useMemo(
    () => mergeSchoolPickerOptions(retainedSchool, results),
    [results, retainedSchool]
  );
  const statusMessage = schoolSearchStatusMessage({
    query: inputValue,
    resultCount: results.length,
    status
  });
  const inputDescribedBy = [describedBy, statusID].filter(Boolean).join(" ");

  useEffect(() => {
    setIsEnhanced(true);
  }, []);

  useEffect(() => {
    if (!isEnhanced) {
      return;
    }

    const query = inputValue.trim();
    if (query.length < 2) {
      setResults([]);
      setStatus("idle");
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setStatus("loading");

      try {
        const params = new URLSearchParams({ q: query, limit: "50" });
        const response = await fetch(`/api/schools?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error("school search failed");
        }

        const payload: unknown = await response.json();
        if (!isSchoolSearchResponse(payload)) {
          throw new Error("invalid school search response");
        }

        setResults(payload.schools);
        setStatus("success");
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }

        setResults([]);
        setStatus("error");
      }
    }, searchDelayMilliseconds);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [inputValue, isEnhanced, retryCount]);

  if (!isEnhanced) {
    return (
      <label className="school-picker__fallback">
        {label}
        <select
          name={name}
          defaultValue={selectedSchool?.id ?? ""}
          required={isRequired}
          aria-describedby={describedBy}
          aria-invalid={isInvalid}
        >
          <option value="">{emptyLabel}</option>
          {options.map((school) => (
            <option key={school.id} value={school.id}>
              {schoolPickerOptionLabel(school)}
            </option>
          ))}
        </select>
        <span className="form-help">
          Use the school search above to load more choices.
        </span>
        {initialSearchFailed ? (
          <span className="form-error">
            We couldn’t load schools. Try the search again.
          </span>
        ) : null}
      </label>
    );
  }

  return (
    <div className="school-picker">
      <input name={name} type="hidden" value={selectedSchool?.id ?? ""} />
      <ComboBox
        allowsEmptyCollection
        defaultFilter={() => true}
        fullWidth
        inputValue={inputValue}
        isInvalid={isInvalid}
        isRequired={isRequired}
        items={options}
        menuTrigger="focus"
        selectedKey={selectedSchool?.id ?? null}
        onInputChange={(value) => {
          setInputValue(value);
          if (
            selectedSchool &&
            value !== schoolPickerOptionLabel(selectedSchool)
          ) {
            setSelectedSchool(undefined);
          }
        }}
        onSelectionChange={(key) => {
          if (key === null) {
            setSelectedSchool(undefined);
            return;
          }

          const nextSchool = options.find(
            (school) => school.id === String(key)
          );
          if (nextSchool) {
            setSelectedSchool(nextSchool);
            setRetainedSchool(nextSchool);
            setInputValue(schoolPickerOptionLabel(nextSchool));
          }
        }}
      >
        <Label>{label}</Label>
        <ComboBox.InputGroup>
          <Input
            aria-describedby={inputDescribedBy || undefined}
            aria-invalid={isInvalid}
            autoComplete="off"
            placeholder="Search by school name"
          />
          <ComboBox.Trigger aria-label={`Show ${label.toLowerCase()} choices`} />
        </ComboBox.InputGroup>
        <ComboBox.Popover>
          <p
            aria-live="polite"
            className={`school-picker__status${status === "error" ? " form-error" : ""}`}
            id={statusID}
            role="status"
          >
            {statusMessage}
          </p>
          {status === "error" ? (
            <Button
              size="sm"
              type="button"
              variant="secondary"
              onPress={() => setRetryCount((count) => count + 1)}
            >
              Try again
            </Button>
          ) : null}
          <ListBox aria-label={`${label} search results`}>
            {(school: SchoolPickerOption) => (
              <ListBox.Item
                id={school.id}
                key={school.id}
                textValue={schoolPickerOptionLabel(school)}
              >
                <span className="school-picker__option">
                  <strong>{school.name}</strong>
                  {school.city || school.state ? (
                    <small>
                      {[school.city, school.state].filter(Boolean).join(", ")}
                    </small>
                  ) : null}
                </span>
                <ListBox.ItemIndicator />
              </ListBox.Item>
            )}
          </ListBox>
        </ComboBox.Popover>
      </ComboBox>
      {!isRequired && selectedSchool ? (
        <Button
          size="sm"
          type="button"
          variant="secondary"
          onPress={() => {
            setSelectedSchool(undefined);
            setRetainedSchool(undefined);
            setInputValue("");
          }}
        >
          Remove school link
        </Button>
      ) : null}
    </div>
  );
}

export function NoScriptSchoolSearch({
  action,
  query,
  queryParam = "school_q"
}: {
  action: string;
  query: string;
  queryParam?: string;
}) {
  return (
    <noscript>
      <form action={action} className="search-bar compact" method="get">
        <label>
          Search schools
          <input
            defaultValue={query}
            name={queryParam}
            placeholder="Search by school name"
            required
            type="search"
          />
        </label>
        <button type="submit">Search</button>
      </form>
    </noscript>
  );
}
