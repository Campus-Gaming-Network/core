import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import test from "node:test";
import {
  schoolsApiResponse,
  schoolsMethodNotAllowedResponse
} from "../src/features/school-slice/schools-api.server.js";
import {
  createApiClient,
  type ApiClient,
  type Fetcher
} from "../src/server/api.server.js";

const school = {
  id: "school-1",
  name: "Example University",
  slug: "example-university",
  city: "Irvine",
  state: "CA",
  is_main_campus: true,
  num_branches: 0
};

function client(fetcher: Fetcher): ApiClient {
  return createApiClient({ baseUrl: "http://api:8080", fetcher });
}

test("school API validates and clamps its query over real HTTP", async () => {
  let upstreamURL = "";
  const api = client(async (input) => {
    upstreamURL = String(input);
    return Response.json({
      schools: [{ ...school, private_note: "strip-me" }],
      limit: 50,
      offset: 0,
      has_more: false
    });
  });

  await withSchoolsServer(api, async (origin) => {
    const response = await fetch(`${origin}/api/schools?q=%20Example%20&limit=500`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), "private, max-age=60");
    assert.deepEqual(await response.json(), {
      schools: [school],
      limit: 50,
      offset: 0,
      has_more: false
    });
    assert.equal(
      upstreamURL,
      "http://api:8080/schools?q=Example&limit=50"
    );

    const head = await fetch(`${origin}/api/schools?q=Example`, {
      method: "HEAD"
    });
    assert.equal(head.status, 200);
    assert.equal(head.headers.get("cache-control"), "private, max-age=60");
    assert.equal(await head.text(), "");

    const invalid = await fetch(`${origin}/api/schools?q=x`);
    assert.equal(invalid.status, 400);
    assert.deepEqual(await invalid.json(), { error: "invalid_school_query" });

    const unsupported = await fetch(`${origin}/api/schools?q=Example`, {
      method: "POST"
    });
    assert.equal(unsupported.status, 405);
    assert.equal(unsupported.headers.get("allow"), "GET, HEAD");
  });
});

test("school API rejects overlong queries without touching the upstream", async () => {
  let calls = 0;
  const response = await schoolsApiResponse(
    new Request(`http://web.test/api/schools?q=${"a".repeat(121)}`),
    {
      api: client(async () => {
        calls += 1;
        return Response.json({});
      })
    }
  );

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "invalid_school_query" });
  assert.equal(calls, 0);
});

test("school API preserves upstream client status and safely maps server/contract errors", async () => {
  const clientError = await schoolsApiResponse(
    new Request("http://web.test/api/schools?q=Example"),
    {
      api: client(async () =>
        Response.json({ error: "invalid_state" }, { status: 422 })
      )
    }
  );
  const serverError = await schoolsApiResponse(
    new Request("http://web.test/api/schools?q=Example"),
    {
      api: client(async () =>
        Response.json({ error: "database_connection_secret" }, { status: 500 })
      )
    }
  );
  const contractError = await schoolsApiResponse(
    new Request("http://web.test/api/schools?q=Example"),
    {
      api: client(async () => Response.json({ schools: "wrong" })),
      reportError: () => undefined
    }
  );

  assert.equal(clientError.status, 422);
  assert.equal(serverError.status, 503);
  assert.equal(contractError.status, 503);
  const bodies = await Promise.all(
    [clientError, serverError, contractError].map((response) => response.json())
  );
  for (const body of bodies) {
    assert.deepEqual(body, { error: "schools_unavailable" });
  }
});

async function withSchoolsServer(
  api: ApiClient,
  verify: (origin: string) => Promise<void>
): Promise<void> {
  const server = createServer(async (request, response) => {
    try {
      const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const webRequest = new Request(`${origin}${request.url ?? "/"}`, {
        method: request.method
      });
      const result = request.method === "GET" || request.method === "HEAD"
        ? await schoolsApiResponse(webRequest, { api })
        : schoolsMethodNotAllowedResponse();
      response.writeHead(result.status, Object.fromEntries(result.headers));
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch (error) {
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  });

  await listen(server);
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await verify(`http://127.0.0.1:${address.port}`);
  } finally {
    await close(server);
  }
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
