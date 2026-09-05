"use client";

import { Button } from "@heroui/react/button";
import Link from "next/link";
import { Icon, appIcon } from "../components/icon";

type ErrorPageProps = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function Error({ error, reset }: ErrorPageProps) {
  return (
    <main className="narrow">
      <section className="page-heading">
        <span className="icon-badge danger">
          <Icon icon={appIcon.error} size="xl" />
        </span>
        <p className="eyebrow">Something went wrong</p>
        <h1>We could not load this page.</h1>
        {/*
          The message is deliberately generic. error.message can carry API
          internals, so only the digest is surfaced — it is the value that
          correlates with server logs.
        */}
        <p className="lede">
          This is usually temporary. Try again, and if it keeps happening let us
          know through support.
        </p>
        {error.digest ? (
          <p className="form-help">Reference: {error.digest}</p>
        ) : null}
        <div className="actions">
          <Button variant="primary" type="button" onPress={reset}>
            <Icon icon={appIcon.retry} />
            Try again
          </Button>
          <Link className="button button--secondary" href="/">
            <Icon icon={appIcon.home} />
            Go home
          </Link>
          <Link className="button button--secondary" href="/support">
            <Icon icon={appIcon.support} />
            Contact support
          </Link>
        </div>
      </section>
    </main>
  );
}
