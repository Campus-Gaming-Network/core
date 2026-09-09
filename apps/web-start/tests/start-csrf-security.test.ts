import assert from "node:assert/strict";
import test from "node:test";
import { csrfSymbol } from "@tanstack/react-start";
import { startInstance } from "../src/start.js";

test("installs explicit fail-closed CSRF middleware for server functions", async () => {
  const options = await startInstance.getOptions();
  const middlewares = options.requestMiddleware;

  assert.ok(middlewares);
  const [middleware] = middlewares;
  assert.ok(middleware);
  assert.equal(Reflect.get(middleware, csrfSymbol), true);

  const origin = process.env.SITE_URL
    ? new URL(process.env.SITE_URL).origin
    : "http://localhost:3100";

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
