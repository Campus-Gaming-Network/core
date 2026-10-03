import { Info, Lock, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

const icons = { info: Info, lock: Lock, shield: ShieldCheck } as const;

/**
 * A filled note with an icon, for reassurance or a heads-up that is not an
 * alert: what is private, what a form will do, what not to enter. `action` is
 * an optional control beside the note, such as a log-in button. It is plain
 * server-rendered markup, so it reads the same before hydration.
 */
export function Callout({
  action,
  children,
  icon = "info",
}: {
  action?: ReactNode;
  children: ReactNode;
  icon?: keyof typeof icons;
}) {
  const Icon = icons[icon];
  return (
    <div
      className={action ? "callout callout--with-action" : "callout"}
      role="note"
    >
      <Icon aria-hidden="true" size={20} strokeWidth={1.75} />
      <p>{children}</p>
      {action ? <div className="callout__action">{action}</div> : null}
    </div>
  );
}
