import assert from "node:assert/strict";
import test from "node:test";
import { csrfSymbol } from "@tanstack/react-start";
import { startInstance } from "../src/start.js";

test("installs explicit fail-closed CSRF middleware for server functions", async () => {
  const options = await startInstance.getOptions();
  const middlewares = options.requestMiddleware;

  assert.ok(middlewares);
  const middleware = middlewares.find(
    (candidate) => Reflect.get(candidate, csrfSymbol) === true
  );
  assert.ok(middleware);
  assert.equal(middlewares.length, 2);

  const origin = process.env.SITE_URL
    ? new URL(process.env.SITE_URL).origin
    : "http://localhost:3000";

  assert.equal(
    (await invokeMiddleware(
      middleware.options.server,
      new Request(`${origin}/_server`, {
        method: "POST",
        headers: { Origin: origin }
      })
    )).status,
    204
  );
  assert.equal(
    (await invokeMiddleware(
      middleware.options.server,
      new Request(`${origin}/_server`, {
        method: "POST",
        headers: { Origin: "https://attacker.example" }
      })
    )).status,
    403
  );
  assert.equal(
    (await invokeMiddleware(
      middleware.options.server,
      new Request(`${origin}/_server`, { method: "POST" })
    )).status,
    403
  );
});

test("request middleware adds security headers without weakening route policy", async () => {
  const options = await startInstance.getOptions();
  const middleware = options.requestMiddleware?.find(
    (candidate) => Reflect.get(candidate, csrfSymbol) !== true
  );
  assert.ok(middleware?.options.server);
  const request = new Request("https://campus.example.test/reset-password");
  const result = await middleware.options.server({
    context: {},
    handlerType: "router",
    next: async () => ({
      context: {},
      pathname: "/reset-password",
      request,
      response: new Response("ok", {
        headers: { "referrer-policy": "no-referrer" }
      })
    }),
    pathname: "/reset-password",
    request
  } as never);

  assert.equal(result instanceof Response, false);
  if (result instanceof Response) assert.fail("expected a request result");
  assert.equal(result.response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(result.response.headers.get("x-frame-options"), "DENY");
  assert.equal(result.response.headers.get("x-content-type-options"), "nosniff");
  assert.match(
    result.response.headers.get("content-security-policy") ?? "",
    /frame-ancestors 'none'/
  );
});

async function invokeMiddleware(
  handler: NonNullable<
    Awaited<ReturnType<typeof startInstance.getOptions>>["requestMiddleware"]
  >[number]["options"]["server"],
  request: Request
): Promise<Response> {
  assert.ok(handler);

  const result = await handler({
    context: {},
    handlerType: "serverFn",
    next: async () => new Response(null, { status: 204 }),
    request
  } as never);

  assert.ok(result instanceof Response);
  return result;
}
