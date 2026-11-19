import { spawn } from "node:child_process";
import { createServer } from "node:http";
import process from "node:process";

const infraName = "apolo-worker-integration";
const queue = [{ id: "integration-create", action: "create", payload: { name: infraName, image: "nginx:alpine" } }];
const results = [];
let activeJob = null;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
  res.setHeader("content-type", "application/json");
  if (req.url === "/api/worker/heartbeat") return res.end(JSON.stringify({ ok: true }));
  if (req.url === "/api/worker/claim") { if (!activeJob && queue.length) activeJob = queue.shift(); return res.end(JSON.stringify({ job: activeJob })); }
  if (req.url === "/api/worker/result") { results.push(body); activeJob = null; return res.end(JSON.stringify({ ok: true })); }
  res.statusCode = 404; res.end(JSON.stringify({ error: "not found" }));
});

function run(bin, args, cwd, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    console.log(`[exec] ${bin} ${args.join(" ")}`);
    const child = spawn(bin, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`${bin} timed out after ${timeoutMs}ms: ${output.slice(-4000)}`)); }, timeoutMs);
    child.stdout.on("data", chunk => { output += chunk; process.stdout.write(chunk); });
    child.stderr.on("data", chunk => { output += chunk; process.stderr.write(chunk); });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => { clearTimeout(timer); if (code === 0) resolve(output); else reject(new Error(`${bin} exited ${code}: ${output.slice(-4000)}`)); });
  });
}

function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error(`Timed out waiting for ${label}`)); }
    }, 300);
  });
}

async function main() {
  await run("podman", ["info", "--format", "json"], undefined, 30000);
  const fs = await import("node:fs/promises");
  const nginxConfig = "/tmp/apolo-integration-nginx.conf";
  const bootstrap = "/tmp/apolo-gateway-bootstrap.conf";
  await fs.writeFile(bootstrap, "server { listen 8080 default_server; server_name _; location / { return 404; } }\n");
  await run("sudo", ["cp", bootstrap, "/etc/nginx/conf.d/apolo-gateway.conf"]);
  await fs.writeFile(nginxConfig, "worker_processes 1;\npid /tmp/apolo-integration-nginx.pid;\nevents { worker_connections 1024; }\nhttp { include /etc/nginx/conf.d/apolo-gateway.conf; }\n");
  await run("sudo", ["nginx", "-c", nginxConfig]);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const agent = spawn("node", ["agent.mjs"], {
    cwd: new URL(".", import.meta.url),
    env: { ...process.env, APOLO_CONTROL_URL: baseUrl, APOLO_WORKER_TOKEN: "integration-test-only-token",
      APOLO_WORKER_ID: "ci-podman-worker", APOLO_WORKER_POLL_MS: "500", APOLO_CONTAINER_ENGINE: "podman",
      APOLO_NGINX_CONFIG: nginxConfig, CODESPACE_NAME: "apolo-ci-test",
      GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN: "app.github.dev" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const agentOutput = [];
  agent.stdout.on("data", chunk => { agentOutput.push(String(chunk)); process.stdout.write(`[worker] ${chunk}`); });
  agent.stderr.on("data", chunk => { agentOutput.push(String(chunk)); process.stderr.write(`[worker] ${chunk}`); });
  const watchdog = setTimeout(() => agent.kill("SIGKILL"), 12 * 60 * 1000);
  try {
    console.log("Waiting for Podman image deployment (max 3 minutes)...");
    await waitFor(() => results.length >= 1, 180000, "container create result");
    if (results[0].status !== "succeeded") throw new Error(`Image create failed: ${results[0].error}\n${agentOutput.join("")}`);
    if (!results[0].result?.host_port || !results[0].result?.container_port) throw new Error("Worker did not report automatically allocated ports.");
    const response = await fetch(`http://127.0.0.1:8080/apps/${infraName}/`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok || !(await response.text()).includes("Welcome to nginx")) throw new Error("Nginx image did not respond through gateway.");
    console.log("Testing direct project-folder upload and automatic image build...");
    const sourceFiles = [
      { path: "index.html", content_base64: Buffer.from("<html><body>APOLO FOLDER UPLOAD OK</body></html>").toString("base64") },
      { path: "assets/status.txt", content_base64: Buffer.from("folder-upload").toString("base64") }
    ];
    queue.push({ id: "integration-source-build", action: "create", payload: { name: infraName, image: `apolo-build/${infraName}:latest`, source_files: sourceFiles } });
    await waitFor(() => results.length >= 2, 240000, "uploaded project folder build result");
    if (results[1].status !== "succeeded") throw new Error(`Project folder build failed: ${results[1].error}\\n${agentOutput.join("")}`);
    const sourceResponse = await fetch(`http://127.0.0.1:8080/apps/${infraName}/`, { signal: AbortSignal.timeout(15000) });
    const sourcePage = await sourceResponse.text();
    if (!sourceResponse.ok || !sourcePage.includes("APOLO FOLDER UPLOAD OK")) throw new Error("Uploaded project folder did not become available through Nginx.");
    console.log("Testing container and Nginx cleanup...");
    queue.push({ id: "integration-delete", action: "delete", payload: { name: infraName } });
    await waitFor(() => results.length >= 3, 90000, "container delete result");
    if (results[2].status !== "succeeded") throw new Error(`Delete failed: ${results[2].error}\n${agentOutput.join("")}`);
    const afterDelete = await fetch(`http://127.0.0.1:8080/apps/${infraName}/`, { signal: AbortSignal.timeout(15000) });
    if (afterDelete.status !== 404) throw new Error(`Nginx route was not removed; HTTP ${afterDelete.status}`);
    console.log("PASS: Podman image deployment, automatic port allocation, project-folder source build, Nginx routing and cleanup.");
  } finally {
    clearTimeout(watchdog);
    agent.kill("SIGTERM");
    await run("podman", ["rm", "-f", infraName], undefined, 15000).catch(() => {});
    await run("sudo", ["nginx", "-s", "quit", "-c", nginxConfig], undefined, 15000).catch(() => {});
    await run("sudo", ["rm", "-f", "/etc/nginx/conf.d/apolo-gateway.conf"], undefined, 15000).catch(() => {});
    server.close();
  }
}

main().catch(error => { console.error(error); process.exitCode = 1; });
