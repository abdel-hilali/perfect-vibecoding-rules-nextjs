// Stands in for "next dev": listens on the port given as the first argument until it is stopped.
import http from "node:http";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1) {
  console.error("usage: node fake-dev-server.mjs <port>");
  process.exit(2);
}
http.createServer((_req, res) => res.end("ok")).listen(port, "127.0.0.1");
