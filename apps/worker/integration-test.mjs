import { spawn } from "node:child_process";
import { createServer } from "node:http";
import process from "node:process";

const infraName = "apolo-worker-integration";
const queue = [
  { id: "integration-create", action: "create", payload: { name: infraName, image: "nginx:alpine", container_port: 80 } },
];
const results = [];
let activeJob = null;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/worker/heartbeat") {
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  if (req.url === "/api/worker/claim") {
    if (!activeJob && queue.length) activeJob = queue.shift();
    res.end(JSON.stringify({ job: activeJob }));
    return;
  }
  if (req.url === "/api/worker/result") {
    results.push(body);
    activeJob = null;
    res.end(JSON.stringify({ ok: true }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: "not found" }));
});

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error(`Timed out waiting for ${label}`));
      }
    }, 300);
  });
}

function run(bin, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", chunk => output += chunk);
    child.stderr.on("data", chunk => output += chunk);
    child.on("error", reject);
    child.on("close", code => code === 0 ? resolve(output) : reject(new Error(`${bin} failed: ${output}`)));
  });
}

async function main() {
  await run("podman", ["info"]);
  const fs = await import("node:fs/promises");
  const nginxConfig = "/tmp/apolo-integration-nginx.conf";
  const bootstrap = "/tmp/apolo-gateway-bootstrap.conf";
  await fs.writeFile(bootstrap, "server { listen 8080 default_server; server_name _; location / { return 404; } }\\n");
  await run("sudo", ["cp", bootstrap, "/etc/nginx/conf.d/apolo-gateway.conf"]);
  await fs.writeFile(nginxConfig, "worker_processes 1;\\npid /tmp/apolo-integration-nginx.pid;\\nevents { worker_connections 1024; }\\nhttp { include /etc/nginx/conf.d/apolo-gateway.conf; }\\n");
  await run("sudo", ["nginx", "-c", nginxConfig]);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const agent = spawn("node", ["agent.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: {
      ...process.env,
      APOLO_CONTROL_URL: baseUrl,
      APOLO_WORKER_TOKEN: "integration-test-only-token",
      APOLO_WORKER_ID: "ci-podman-worker",
      APOLO_WORKER_POLL_MS: "500",
      APOLO_CONTAINER_ENGINE: "podman",
      APOLO_NGINX_CONFIG: nginxConfig,
      CODESPACE_NAME: "apolo-ci-test",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let agentOutput = "";
  agent.stdout.on("data", chunk => agentOutput += chunk);
  agent.stderr.on("data", chunk => agentOutput += chunk);
  try {
    await waitFor(() => results.length >= 1, 180000, "container create result");
    if (results[0].status !== "succeeded") throw new Error(`Create failed: ${results[0].error}\n${agentOutput}`);
    const response = await fetch(`http://127.0.0.1:8080/apps/${infraName}/`);
    if (!response.ok) throw new Error(`Nginx gateway returned HTTP ${response.status}\n${agentOutput}`);
    const page = await response.text();
    if (!page.includes("Welcome to nginx")) throw new Error("Nginx container response did not match expected page");

    queue.push({ id: "integration-delete", action: "delete", payload: { name: infraName } });
    await waitFor(() => results.length >= 2, 90000, "container delete result");
    if (results[1].status !== "succeeded") throw new Error(`Delete failed: ${results[1].error}\n${agentOutput}`);
    const afterDelete = await fetch(`http://127.0.0.1:8080/apps/${infraName}/`);
    if (afterDelete.status !== 404) throw new Error(`Nginx route was not removed; HTTP ${afterDelete.status}`);
    console.log("PASS: Codespaces worker created a Podman container, routed it through Nginx, and removed both container and route.");
  } finally {
    agent.kill("SIGTERM");
    await run("podman", ["rm", "-f", infraName]).catch(() => {});
    await run("sudo", ["nginx", "-s", "quit", "-c", nginxConfig]).catch(() => {});
    await run("sudo", ["rm", "-f", "/etc/nginx/conf.d/apolo-gateway.conf"]).catch(() => {});
    server.close();
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
