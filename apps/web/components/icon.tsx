import {
  ArrowUpRight,
  BadgeCheck,
  CalendarDays,
  CircleQuestionMark,
  CircleUser,
  Clock,
  CreditCard,
  FileText,
  Gamepad2,
  GraduationCap,
  House,
  Info,
  LifeBuoy,
  ListFilter,
  LoaderCircle,
  Lock,
  LogIn,
  LogOut,
  MapPin,
  Plus,
  Repeat,
  RotateCcw,
  Search,
  SearchX,
  ShieldCheck,
  Star,
  TriangleAlert,
  UserPlus,
  Users,
  type LucideIcon
} from "lucide-react";

/**
 * Semantic icon registry. Pages and components name the *concept* rather than
 * the glyph, so an icon swap is a single edit here instead of a search across
 * every route. Keep this list small: an icon that appears once is usually
 * decoration, and decoration on a page nobody asked for is noise.
 *
 * Only import from this module, never from "lucide-react" directly. That keeps
 * the tree-shaking surface and the accessibility rules in one place.
 */
export const appIcon = {
  about: Info,
  account: CircleUser,
  capacity: Users,
  create: Plus,
  error: TriangleAlert,
  event: CalendarDays,
  external: ArrowUpRight,
  faq: CircleQuestionMark,
  filter: ListFilter,
  game: Gamepad2,
  home: House,
  interested: Star,
  loading: LoaderCircle,
  locked: Lock,
  logIn: LogIn,
  logOut: LogOut,
  notFound: SearchX,
  payment: CreditCard,
  place: MapPin,
  privacy: ShieldCheck,
  repeats: Repeat,
  retry: RotateCcw,
  school: GraduationCap,
  search: Search,
  signUp: UserPlus,
  support: LifeBuoy,
  team: Users,
  terms: FileText,
  time: Clock,
  verified: BadgeCheck
} as const satisfies Record<string, LucideIcon>;

export type AppIconName = keyof typeof appIcon;

type IconProps = {
  /** A member of {@link appIcon}, e.g. `appIcon.event`. */
  icon: LucideIcon;
  /**
   * Accessible name. Omit it for the common case: an icon paired with visible
   * text is decoration and must stay out of the accessibility tree, or screen
   * readers announce the label twice. Pass one only when the icon is the sole
   * carrier of meaning, and remember that a labelled icon inside a button
   * becomes part of that button's accessible name.
   */
  label?: string;
  /** Size step. `md` (1em) tracks the surrounding font size. */
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

/**
 * Renders a Lucide glyph at a size the stylesheet controls.
 *
 * Sizing lives in CSS (`.icon` in globals.css) rather than the `size` prop, so
 * inline icons scale with their text instead of pinning to Lucide's 24px
 * default. The rendered width/height attributes stay as the intrinsic size and
 * the stylesheet overrides them, which avoids an unsized SVG before CSS loads.
 *
 * Note that Lucide components carry "use client" — v1 reads its defaults from a
 * React context — so every icon is a leaf client component even inside a Server
 * Component page. That is acceptable for leaf SVGs, and Next.js tree-shakes the
 * package by default (`lucide-react` ships in its optimizePackageImports list),
 * but it is the reason this wrapper exists: if that cost ever matters, the
 * rendering strategy changes here alone.
 */
export function Icon({ icon: Glyph, label, size = "md", className }: IconProps) {
  const classes = ["icon", `icon--${size}`, className]
    .filter(Boolean)
    .join(" ");

  return (
    <Glyph
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={classes}
      role={label ? "img" : undefined}
    />
  );
}
