import {
  setTeamCaptainAction,
  transferTeamOwnershipAction
} from "../app/actions";
import {
  type Team,
  type TeamMember,
  teamRoleLabel
} from "../lib/cgn-api";

type TeamManagementPanelProps = {
  team: Team;
};

export function TeamManagementPanel({ team }: TeamManagementPanelProps) {
  const members = team.members ?? [];
  const manageableMembers = members.filter((member) => member.role !== "owner");

  if (team.viewer_role !== "owner") {
    return null;
  }

  return (
    <div className="form-stack">
      <section aria-labelledby="captain-management">
        <h3 id="captain-management">Captains</h3>
        <p className="form-help">
          Captains can represent the team in future tournament and team activity
          flows. Owners can add or remove captain status at any time.
        </p>
        {manageableMembers.length > 0 ? (
          <div className="list">
            {manageableMembers.map((member) => (
              <MemberManagementRow
                key={member.user_id}
                member={member}
                slug={team.slug}
              />
            ))}
          </div>
        ) : (
          <p className="empty-state">
            Members will appear here after they join with the team password.
          </p>
        )}
      </section>

      <section aria-labelledby="ownership-transfer">
        <h3 id="ownership-transfer">Transfer ownership</h3>
        {manageableMembers.length > 0 ? (
          <form action={transferTeamOwnershipAction} className="form-stack">
            <input type="hidden" name="slug" value={team.slug} />
            <label>
              New owner
              <select name="new_owner_user_id" required>
                {manageableMembers.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.name} · {teamRoleLabel(member.role)}
                  </option>
                ))}
              </select>
            </label>
            <p className="form-help">
              Ownership transfer is immediate. You will remain on the team as a
              member after the transfer.
            </p>
            <button className="secondary" type="submit">
              Transfer ownership
            </button>
          </form>
        ) : (
          <p className="empty-state">
            Add another member before transferring ownership.
          </p>
        )}
      </section>
    </div>
  );
}

function MemberManagementRow({
  member,
  slug
}: {
  member: TeamMember;
  slug: string;
}) {
  const isCaptain = member.role === "captain";

  return (
    <div className="list-item">
      <span className="event-card-heading">
        <strong>{member.name}</strong>
        <small>{teamRoleLabel(member.role)}</small>
      </span>
      <form action={setTeamCaptainAction}>
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="user_id" value={member.user_id} />
        <input type="hidden" name="captain" value={isCaptain ? "false" : "true"} />
        <button className={isCaptain ? "secondary" : "primary"} type="submit">
          {isCaptain ? "Remove captain" : "Make captain"}
        </button>
      </form>
    </div>
  );
}
