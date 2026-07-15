"use client";

import { Alert } from "@heroui/react/alert";
import { Button } from "@heroui/react/button";
import { Checkbox } from "@heroui/react/checkbox";
import { Fieldset } from "@heroui/react/fieldset";
import { Input } from "@heroui/react/input";
import { ListBox } from "@heroui/react/list-box";
import { Select } from "@heroui/react/select";
import { TextArea } from "@heroui/react/textarea";
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
        <Alert
          className={`notice ${state.status}`}
          status={state.status === "error" ? "danger" : "success"}
        >
          {state.message}
        </Alert>
      ) : null}

      <label>
        Team name
        <Input name="name" required maxLength={120} />
      </label>

      <label>
        Description
        <TextArea name="description" maxLength={5000} rows={6} />
      </label>

      <label>
        School link
        <Select fullWidth name="school_id" defaultSelectedKey={defaultSchoolID ?? ""}>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="" textValue="No school link yet">
                No school link yet
              </ListBox.Item>
              {schools.map((school) => {
                const label = `${school.name}${
                  school.city || school.state
                    ? ` (${[school.city, school.state].filter(Boolean).join(", ")})`
                    : ""
                }`;

                return (
                  <ListBox.Item id={school.id} key={school.id} textValue={label}>
                    {label}
                  </ListBox.Item>
                );
              })}
            </ListBox>
          </Select.Popover>
        </Select>
      </label>

      <Fieldset>
        <Fieldset.Legend>Games</Fieldset.Legend>
        {games.map((game) => (
          <Checkbox className="check-row" key={game.id} name="game_ids" value={game.id}>
            {game.name}
          </Checkbox>
        ))}
      </Fieldset>

      <label>
        Join password
        <Input
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

      <Button type="submit" isDisabled={pending}>
        {pending ? "Creating..." : "Create team"}
      </Button>
    </form>
  );
}
