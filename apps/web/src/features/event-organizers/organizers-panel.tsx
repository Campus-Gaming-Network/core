import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useRef, useState, type FormEvent } from "react";
import { ConfirmDialog } from "../../components/confirm-dialog";
import {
  FormErrorSummary,
  useEnhancedMutation,
} from "../../components/enhanced-mutation";
import { PageNoticeView } from "../../components/page-notice-view";
import type { EventDTO } from "../event-slice/contracts";
import {
  organizerNotices,
  type OrganizerInvitesResult,
  type OrganizerMutationResult,
  type OrganizerNotice,
} from "./contracts";
import {
  inviteOrganizer,
  leaveOrganizers,
  removeOrganizer,
  revokeOrganizerInvite,
  transferEventCreator,
} from "./organizer.functions";

type Organizer = NonNullable<EventDTO["organizers"]>[number];

/**
 * The edit page's Organizers section. The creator invites co-organizers by
 * email, withdraws invitations, removes co-organizers, and hands the event to
 * one of them; a co-organizer can step down. Every control is a native form,
 * so it works without JavaScript.
 */
export function OrganizersPanel({
  invites,
  notice,
  organizers,
  slug,
  viewerID,
  viewerIsCreator,
}: {
  invites?: OrganizerInvitesResult;
  notice?: OrganizerNotice;
  organizers: Organizer[];
  slug: string;
  viewerID: string;
  viewerIsCreator: boolean;
}) {
  const mutation = useEnhancedMutation(
    "We could not update the organizers. Please try again.",
  );
  const run = (request: () => Promise<OrganizerMutationResult>) =>
    mutation.execute(request);

  return (
    <section
      aria-labelledby="organizers-heading"
      className="panel event-organizers"
      id="organizers"
    >
      <h2 id="organizers-heading">Organizers</h2>
      <p className="form-help">
        {viewerIsCreator
          ? "Co-organizers can edit this event. Only you can cancel it or change who organizes it."
          : "Co-organizers can edit this event. Only its creator can cancel it or change who organizes it."}
      </p>
      <PageNoticeView notice={notice ? organizerNotices[notice] : undefined} />
      <FormErrorSummary
        fieldErrors={mutation.fieldErrors}
        message={mutation.message}
        summaryRef={mutation.errorSummaryRef}
      />
      <ul className="event-organizers__list">
        {organizers.map((organizer) => (
          <li key={organizer.id}>
            <span>
              <Link to="/users/$id" params={{ id: organizer.public_id }}>
                {organizer.name}
              </Link>
              <small>
                {organizer.role === "creator"
                  ? " · Creator"
                  : " · Co-organizer"}
                {organizer.id === viewerID ? " (you)" : ""}
              </small>
            </span>
            <span className="actions">
              {viewerIsCreator && organizer.role === "organizer" ? (
                <>
                  <TransferForm
                    name={organizer.name}
                    pending={mutation.pending}
                    run={run}
                    slug={slug}
                    userID={organizer.id}
                  />
                  <OrganizerButton
                    action={removeOrganizer}
                    label="Remove"
                    name={organizer.name}
                    pending={mutation.pending}
                    run={run}
                    slug={slug}
                    userID={organizer.id}
                  />
                </>
              ) : null}
              {!viewerIsCreator && organizer.id === viewerID ? (
                <OrganizerButton
                  action={leaveOrganizers}
                  label="Step down"
                  pending={mutation.pending}
                  run={run}
                  slug={slug}
                  userID={organizer.id}
                />
              ) : null}
            </span>
          </li>
        ))}
      </ul>
      {viewerIsCreator ? (
        <InviteSection
          invites={invites}
          pending={mutation.pending}
          run={run}
          slug={slug}
        />
      ) : null}
    </section>
  );
}

function InviteSection({
  invites,
  pending,
  run,
  slug,
}: {
  invites?: OrganizerInvitesResult;
  pending: boolean;
  run: (request: () => Promise<OrganizerMutationResult>) => Promise<void>;
  slug: string;
}) {
  const runInvite = useServerFn(inviteOrganizer);
  const runRevoke = useServerFn(revokeOrganizerInvite);

  function submitWith(
    request: (data: FormData) => Promise<OrganizerMutationResult>,
  ) {
    return async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      await run(() => request(data));
    };
  }

  return (
    <>
      <h3>Invite a co-organizer</h3>
      <form
        action={inviteOrganizer.url}
        className="form-stack"
        method="post"
        onSubmit={submitWith((data) => runInvite({ data }))}
      >
        <input name="slug" type="hidden" value={slug} />
        <label>
          Email address
          <input
            autoCapitalize="none"
            autoComplete="off"
            enterKeyHint="send"
            inputMode="email"
            maxLength={254}
            name="email"
            required
            spellCheck={false}
            type="email"
          />
        </label>
        <p className="form-help">
          We email them a link that works for seven days. They accept by signing
          in with that address.
        </p>
        <div className="form-actions">
          <button disabled={pending} type="submit">
            Send invitation
          </button>
        </div>
      </form>
      {invites?.status === "unavailable" ? (
        <p>Pending invitations are unavailable right now.</p>
      ) : invites && invites.invites.length > 0 ? (
        <>
          <h3>Pending invitations</h3>
          <ul className="event-organizers__list">
            {invites.invites.map((invite) => (
              <li key={invite.id}>
                <span>{invite.email}</span>
                <form
                  action={revokeOrganizerInvite.url}
                  method="post"
                  onSubmit={submitWith((data) => runRevoke({ data }))}
                >
                  <input name="slug" type="hidden" value={slug} />
                  <input name="invite_id" type="hidden" value={invite.id} />
                  <button
                    className="button--secondary button--small"
                    disabled={pending}
                    type="submit"
                  >
                    Withdraw
                    <span className="visually-hidden">
                      {" "}
                      invitation to {invite.email}
                    </span>
                  </button>
                </form>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function OrganizerButton({
  action,
  label,
  name,
  pending,
  run,
  slug,
  userID,
}: {
  action: typeof removeOrganizer | typeof leaveOrganizers;
  label: string;
  name?: string;
  pending: boolean;
  run: (request: () => Promise<OrganizerMutationResult>) => Promise<void>;
  slug: string;
  userID: string;
}) {
  const runAction = useServerFn(action);
  return (
    <form
      action={action.url}
      method="post"
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        await run(() => runAction({ data }));
      }}
    >
      <input name="slug" type="hidden" value={slug} />
      <input name="user_id" type="hidden" value={userID} />
      <button
        className="button--secondary button--small"
        disabled={pending}
        type="submit"
      >
        {label}
        {name ? <span className="visually-hidden"> {name}</span> : null}
      </button>
    </form>
  );
}

// Handing over the event is hard to undo, so it asks first. Without
// JavaScript the form submits directly.
function TransferForm({
  name,
  pending,
  run,
  slug,
  userID,
}: {
  name: string;
  pending: boolean;
  run: (request: () => Promise<OrganizerMutationResult>) => Promise<void>;
  slug: string;
  userID: string;
}) {
  const runTransfer = useServerFn(transferEventCreator);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const data = new FormData(event.currentTarget);
    await run(() => runTransfer({ data }));
  }

  return (
    <form action={transferEventCreator.url} method="post" onSubmit={submit}>
      <input name="slug" type="hidden" value={slug} />
      <input name="user_id" type="hidden" value={userID} />
      <button
        className="button--secondary button--small"
        disabled={pending}
        ref={triggerRef}
        type="submit"
      >
        Make creator<span className="visually-hidden"> {name}</span>
      </button>
      <ConfirmDialog
        cancelLabel="Keep the event"
        confirmLabel={`Yes, hand it to ${name}`}
        heading={`Hand this event to ${name}?`}
        onClose={() => setConfirming(false)}
        open={confirming}
        pending={pending}
        returnFocusRef={triggerRef}
      >
        <p>
          {name} becomes the creator and can cancel the event or remove you. You
          stay on as a co-organizer.
        </p>
      </ConfirmDialog>
    </form>
  );
}
