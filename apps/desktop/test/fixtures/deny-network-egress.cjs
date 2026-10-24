const blocked = (kind, value) => {
  const detail = typeof value === "string" ? value.slice(0, 240) : "unknown";
  process.stderr.write(`[desktop-network-guard] blocked ${kind} ${detail}\n`);
  throw new Error(`desktop_network_egress_blocked:${kind}`);
};

globalThis.fetch = (...args) => Promise.reject(new Error(blocked("fetch", String(args[0]))));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const http = require("node:http");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const https = require("node:https");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const net = require("node:net");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const tls = require("node:tls");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dns = require("node:dns");

http.request = (...args) => blocked("http.request", String(args[0]));
http.get = (...args) => blocked("http.get", String(args[0]));
https.request = (...args) => blocked("https.request", String(args[0]));
https.get = (...args) => blocked("https.get", String(args[0]));
net.connect = (...args) => blocked("net.connect", String(args[0]));
net.createConnection = (...args) => blocked("net.createConnection", String(args[0]));
tls.connect = (...args) => blocked("tls.connect", String(args[0]));
dns.lookup = (...args) => blocked("dns.lookup", String(args[0]));
/* global process, require */
