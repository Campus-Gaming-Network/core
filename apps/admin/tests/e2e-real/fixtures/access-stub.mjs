import http from "node:http";

// Publishes the run's Access signing key where the API and the Admin BFF look
// for Cloudflare Access certificates.
const port = Number.parseInt(process.env.PORT ?? "18085", 10);
const jwks = JSON.stringify({
  keys: [JSON.parse(process.env.ADMIN_REAL_E2E_PUBLIC_JWK ?? "null")],
});

http
  .createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200).end("ok");
    } else if (request.url === "/cdn-cgi/access/certs") {
      response.writeHead(200, { "content-type": "application/json" }).end(jwks);
    } else {
      response.writeHead(404).end();
    }
  })
  .listen(port, "127.0.0.1");
