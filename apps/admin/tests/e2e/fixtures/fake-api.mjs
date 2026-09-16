import http from "node:http";

const port = Number.parseInt(process.env.PORT ?? "18082", 10);
const server = http.createServer((request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.url === "/health") {
    response.writeHead(200);
    response.end(JSON.stringify({ service: "fake-admin-api", status: "ok" }));
    return;
  }
  response.writeHead(404);
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, "127.0.0.1");
