#!/usr/bin/env node
const http = require("node:http");

const HOST = "127.0.0.1";
const PORT = Number(process.env.CURSOR_LIGHT_PORT || 18765);

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data.trim()));
    if (process.stdin.isTTY) resolve("");
  });
}

function parseArgs(argv) {
  return argv.reduce((acc, arg) => {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) acc[match[1]] = match[2];
    return acc;
  }, {});
}

function writeCursorResponse(eventName) {
  if (eventName === "beforeSubmitPrompt") {
    process.stdout.write(JSON.stringify({ continue: true }));
    return;
  }

  if (/^before/.test(eventName)) {
    process.stdout.write(JSON.stringify({ permission: "allow" }));
    return;
  }

  if (eventName === "stop") {
    process.stdout.write(JSON.stringify({}));
  }
}

function post(payload) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request(
      {
        hostname: HOST,
        port: PORT,
        path: "/hook",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 900
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode < 400));
      }
    );

    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.end(body);
  });
}

(async () => {
  const args = parseArgs(process.argv.slice(2));
  const stdin = await readStdin();
  let hookPayload = {};

  if (stdin) {
    try {
      hookPayload = JSON.parse(stdin);
    } catch {
      hookPayload = { message: stdin };
    }
  }

  const payload = {
    ...hookPayload,
    event: args.event || hookPayload.event || hookPayload.hook || "cursor-hook",
    status: args.status || hookPayload.status,
    message: args.message || hookPayload.message
  };

  await post(payload);
  writeCursorResponse(payload.event);
  process.exit(0);
})();
