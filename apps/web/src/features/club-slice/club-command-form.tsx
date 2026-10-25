import { useServerFn } from "@tanstack/react-start";
import type { FormEvent, ReactNode } from "react";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation";
import { runClubCommand } from "./club.functions";
import { clubNotices, type ClubCommandName, type ClubPage } from "./contracts";
import { Button } from "../../components/button";

/**
 * A native form for one club command. Without JavaScript it posts and the
 * server redirects back with a notice; with it, errors show in place.
 */
export function ClubCommandForm({
  command,
  slug,
  page,
  submitLabel,
  pendingLabel = "Saving…",
  className = "form-stack",
  variant,
  hidden,
  fieldIds,
  children,
}: {
  command: ClubCommandName;
  slug: string;
  page: ClubPage;
  submitLabel: string;
  pendingLabel?: string;
  className?: string;
  variant?: "secondary" | "destructive";
  hidden?: Record<string, string>;
  fieldIds?: Record<string, string>;
  children?: (fieldErrors: Record<string, string[] | undefined>) => ReactNode;
}) {
  const run = useServerFn(runClubCommand);
  const mutation = useEnhancedMutation(clubNotices.failed.message);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    await mutation.execute(() => run({ data }));
  }

  return (
    <form
      action={runClubCommand.url}
      className={className}
      method="post"
      onSubmit={submit}
    >
      <input name="command" type="hidden" value={command} />
      <input name="slug" type="hidden" value={slug} />
      <input name="page" type="hidden" value={page} />
      {Object.entries(hidden ?? {}).map(([name, value]) => (
        <input key={name} name={name} type="hidden" value={value} />
      ))}
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        fieldIds={fieldIds}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      {children?.(mutation.fieldErrors)}
      <div className="form-actions">
        <Button variant={variant} disabled={mutation.pending} type="submit">
          {mutation.pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
