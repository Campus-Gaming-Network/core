import { redirect } from "next/navigation";
import { pageMetadata } from "../../../lib/metadata";

export const metadata = pageMetadata({
  title: "Reset password",
  description:
    "Choose a new password for your Campus Gaming Network account.",
  path: "/auth/reset-password",
  noIndex: true
});

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function LegacyResetPasswordPage({
  searchParams
}: PageProps) {
  const params = await searchParams;
  const token = param(params.token);
  const destination = token
    ? `/reset-password?token=${encodeURIComponent(token)}`
    : "/reset-password";

  redirect(destination);
}

function param(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}
