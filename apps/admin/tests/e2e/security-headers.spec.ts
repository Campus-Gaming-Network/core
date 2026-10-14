import { expect, test } from "@playwright/test";

test("HTML and errors are private, non-indexable, and framed defensively", async ({
  request,
}) => {
  const responses = await Promise.all(
    ["/", "/missing-admin-page"].map((path) => request.get(path)),
  );
  for (const response of responses) {
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["cross-origin-opener-policy"]).toBe(
      "same-origin",
    );
    expect(response.headers()["x-content-type-options"]).toBe("nosniff");
    expect(response.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
  }
});

test("every inline script carries the nonce its response allows", async ({
  request,
}) => {
  const response = await request.get("/");
  const policy = response.headers()["content-security-policy"] ?? "";
  const nonce = /script-src 'self' 'nonce-([^']+)'/.exec(policy)?.[1];
  expect(nonce, policy).toBeTruthy();
  expect(policy).not.toContain("unsafe-eval");

  const scripts = [...(await response.text()).matchAll(/<script\b[^>]*>/g)];
  expect(scripts.length).toBeGreaterThan(0);
  for (const [script] of scripts) {
    expect(script).toContain(`nonce="${nonce}"`);
  }
});
