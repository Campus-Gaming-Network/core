import { expect, test } from "@playwright/test";

test("HTML and errors are private, non-indexable, and framed defensively", async ({
  request
}) => {
  const responses = await Promise.all(
    ["/", "/missing-admin-page"].map((path) => request.get(path))
  );
  for (const response of responses) {
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    expect(response.headers()["x-robots-tag"]).toContain("noindex");
    expect(response.headers()["x-frame-options"]).toBe("DENY");
    expect(response.headers()["referrer-policy"]).toBe("no-referrer");
    expect(response.headers()["content-security-policy"]).toContain(
      "frame-ancestors 'none'"
    );
  }
});
