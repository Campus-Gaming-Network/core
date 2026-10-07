import http from "node:http";

// An S3-compatible bucket for school logos: path-style PUT and DELETE from the
// API, and public GET for the browser, kept in memory.
const port = Number.parseInt(process.env.PORT ?? "18086", 10);
const objects = new Map<string, { body: Buffer; contentType: string }>();

http
  .createServer((request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://stub");
    if (pathname === "/health") {
      response.writeHead(200).end("ok");
      return;
    }
    if (request.method === "PUT") {
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        objects.set(pathname, {
          body: Buffer.concat(chunks),
          contentType: request.headers["content-type"] ?? "",
        });
        response.writeHead(200, { etag: '"stub"' }).end();
      });
    } else if (request.method === "DELETE") {
      objects.delete(pathname);
      response.writeHead(204).end();
    } else if (request.method === "GET" || request.method === "HEAD") {
      const object = objects.get(pathname);
      if (!object) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        "content-type": object.contentType,
        "content-length": object.body.length,
      });
      response.end(request.method === "HEAD" ? undefined : object.body);
    } else {
      response.writeHead(405).end();
    }
  })
  .listen(port, "127.0.0.1");
