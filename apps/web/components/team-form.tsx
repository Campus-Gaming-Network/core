"use client";

import { useActionState } from "react";
import { createTeamAction } from "../app/actions";
import {
  type Game,
  type School
} from "../lib/cgn-api";
import { initialFormState } from "../lib/form-state";

type TeamFormProps = {
  games: Game[];
  schools: School[];
  defaultSchoolID?: string;
};

export function TeamForm({
  games,
  schools,
  defaultSchoolID
}: TeamFormProps) {
  const [state, action, pending] = useActionState(
    createTeamAction,
    initialFormState
  );

  return (
    <form action={action} className="form-stack">
      {state.message ? (
        <p className={`notice ${state.status}`}>{state.message}</p>
      ) : null}

      <label>
        Team name
        <input name="name" required maxLength={120} />
      </label>

      <label>
        Description
        <textarea name="description" maxLength={5000} rows={6} />
      </label>

      <label>
        School link
        <select name="school_id" defaultValue={defaultSchoolID ?? ""}>
          <option value="">No school link yet</option>
          {schools.map((school) => (
            <option key={school.id} value={school.id}>
              {school.name}
              {school.city || school.state
                ? ` (${[school.city, school.state].filter(Boolean).join(", ")})`
                : ""}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend>Games</legend>
        {games.map((game) => (
          <label className="check-row" key={game.id}>
            <input name="game_ids" type="checkbox" value={game.id} />
            {game.name}
          </label>
        ))}
      </fieldset>

      <label>
        Join password
        <input
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </label>
      <p className="form-help">
        Team pages are public. This password is only for joining or interacting
        with the team as a member.
      </p>

      <button type="submit" disabled={pending}>
        {pending ? "Creating..." : "Create team"}
      </button>
    </form>
  );
}
