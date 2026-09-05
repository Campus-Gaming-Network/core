import assert from "node:assert/strict";
import test from "node:test";
import {
  hydrateSchoolPickerSelection,
  isSchoolSearchResponse,
  mergeSchoolPickerOptions,
  schoolPickerOptionLabel,
  schoolSearchStatusMessage
} from "../lib/school-picker-model.js";

const currentSchool = {
  id: "school-current",
  name: "Current University",
  city: "Irvine",
  state: "CA"
};

const distantSchool = {
  id: "school-distant",
  name: "Zzyzx Institute",
  city: "Zzyzx",
  state: "CA"
};

test("school picker keeps the current selection outside the latest results", () => {
  assert.deepEqual(
    mergeSchoolPickerOptions(currentSchool, [distantSchool]),
    [currentSchool, distantSchool]
  );
  assert.deepEqual(
    mergeSchoolPickerOptions(currentSchool, [currentSchool, distantSchool]),
    [currentSchool, distantSchool]
  );
});

test("school picker hydrates known and temporarily unknown selections", () => {
  assert.deepEqual(
    hydrateSchoolPickerSelection(currentSchool.id, undefined, [currentSchool]),
    currentSchool
  );
  assert.deepEqual(
    hydrateSchoolPickerSelection("school-outside-results", undefined, []),
    { id: "school-outside-results", name: "Selected school" }
  );
});

test("school picker formats locations and reports each search state", () => {
  assert.equal(
    schoolPickerOptionLabel(currentSchool),
    "Current University (Irvine, CA)"
  );
  assert.equal(
    schoolSearchStatusMessage({ query: "", resultCount: 0, status: "idle" }),
    "Type at least 2 characters to search every active school."
  );
  assert.equal(
    schoolSearchStatusMessage({
      query: "Zzyzx",
      resultCount: 0,
      status: "loading"
    }),
    "Searching schools…"
  );
  assert.equal(
    schoolSearchStatusMessage({
      query: "Zzyzx",
      resultCount: 0,
      status: "success"
    }),
    "No schools found for “Zzyzx”."
  );
  assert.equal(
    schoolSearchStatusMessage({
      query: "Zzyzx",
      resultCount: 0,
      status: "error"
    }),
    "We couldn’t load schools. Check your connection and try again."
  );
});

test("school search responses reject malformed options", () => {
  assert.equal(
    isSchoolSearchResponse({ schools: [currentSchool, distantSchool] }),
    true
  );
  assert.equal(isSchoolSearchResponse({ schools: [{ id: "missing-name" }] }), false);
  assert.equal(isSchoolSearchResponse({ schools: "not-an-array" }), false);
});
