import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

const port = Number.parseInt(process.env.PORT ?? "18083", 10);
const expectedAPIKey = process.env.RESEND_STUB_API_KEY ?? "real-e2e-resend-key";
type StubMessage = {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string;
  attachments: unknown[];
  idempotencyKey: string;
};

const messages: StubMessage[] = [];

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://resend-stub.local");

  if (request.method === "GET" && url.pathname === "/health") {
    return json(response, 200, { service: "resend-stub", status: "ok" });
  }
  if (request.method === "GET" && url.pathname === "/__test/messages") {
    const recipient = url.searchParams.get("recipient")?.trim().toLowerCase();
    const matching = recipient
      ? messages.filter((message) =>
          message.to.some((value) => value.toLowerCase() === recipient),
        )
      : messages;
    return json(response, 200, { messages: matching });
  }
  if (request.method === "POST" && url.pathname === "/emails") {
    if (request.headers.authorization !== `Bearer ${expectedAPIKey}`) {
      return json(response, 401, { message: "invalid API key" });
    }
    const payload = await readJSON(request);
    if (
      !payload ||
      !Array.isArray(payload.to) ||
      typeof payload.subject !== "string"
    ) {
      return json(response, 400, { message: "invalid payload" });
    }
    const id = `stub-message-${messages.length + 1}`;
    messages.push({
      id,
      from: String(payload.from ?? ""),
      to: payload.to.map(String),
      subject: payload.subject,
      html: String(payload.html ?? ""),
      attachments: Array.isArray(payload.attachments)
        ? payload.attachments
        : [],
      idempotencyKey: String(request.headers["idempotency-key"] ?? ""),
    });
    return json(response, 202, { id });
  }

  return json(response, 404, { message: "not found" });
});

server.listen(port, "127.0.0.1");

async function readJSON(
  request: IncomingMessage,
): Promise<Record<string, unknown> | null> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return null;
  }
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
