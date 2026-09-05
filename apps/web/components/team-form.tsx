"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Fieldset } from "@heroui/react/fieldset";
import { Input } from "@heroui/react/input";
import { TextArea } from "@heroui/react/textarea";
import { useActionState } from "react";
import { FieldError, fieldErrorProps } from "./form-field-error";
import { SchoolPicker } from "./school-picker";
import { createTeamAction } from "../app/actions";
import {
  type Game,
  type School,
  type SchoolSummary
} from "../lib/cgn-api";
import { initialFormState } from "../lib/form-state";

type TeamFormProps = {
  games: Game[];
  schools: School[];
  defaultSchoolID?: string;
  defaultSchool?: SchoolSummary;
  initialSchoolQuery?: string;
  initialSchoolSearchFailed?: boolean;
};

export function TeamForm({
  games,
  schools,
  defaultSchoolID,
  defaultSchool,
  initialSchoolQuery,
  initialSchoolSearchFailed
}: TeamFormProps) {
  const [state, action, pending] = useActionState(
    createTeamAction,
    initialFormState
  );

  return (
    <form action={action} className="form-stack">
      {state.message ? (
        <Alert
      status={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </Alert>
      ) : null}

      <label>
        Team name
        <Input
          name="name"
          required
          maxLength={120}
          {...fieldErrorProps(state, "name")}
        />
        <FieldError name="name" state={state} />
      </label>

      <label>
        Description
        <TextArea
          name="description"
          maxLength={5000}
          rows={6}
          {...fieldErrorProps(state, "description")}
        />
        <FieldError name="description" state={state} />
      </label>

      <SchoolPicker
        name="school_id"
        label="School link"
        initialSchools={schools}
        initialQuery={initialSchoolQuery}
        initialSearchFailed={initialSchoolSearchFailed}
        selectedSchool={defaultSchool}
        selectedSchoolID={defaultSchoolID}
        emptyLabel="No school link yet"
      />

      <Fieldset>
        <Fieldset.Legend>Games</Fieldset.Legend>
        {games.map((game) => (
          <label className="checkbox-field" key={game.id}>
            <input
              type="checkbox"
              name="game_ids"
              value={game.id}
              {...fieldErrorProps(state, "game_ids")}
            />
            {game.name}
          </label>
        ))}
        <FieldError name="game_ids" state={state} />
      </Fieldset>

      <label>
        Join password
        <Input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
          {...fieldErrorProps(state, "password")}
        />
        <FieldError name="password" state={state} />
      </label>
      <p className="form-help">
        Team pages are public. This password is only for joining or interacting
        with the team as a member.
      </p>

      <Button type="submit" isDisabled={pending}>
        {pending ? "Creating..." : "Create team"}
      </Button>
    </form>
  );
}
