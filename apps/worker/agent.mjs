import { spawn } from "node:child_process";
import os from "node:os";
import process from "node:process";

const baseUrl = (process.env.APOLO_CONTROL_URL || "").replace(/\/$/, "");
const token = process.env.APOLO_WORKER_TOKEN || "";
const workerId = process.env.APOLO_WORKER_ID || os.hostname();
const pollMs = Number(process.env.APOLO_WORKER_POLL_MS || 5000);

if (!baseUrl || !token) {
  console.error("Set APOLO_CONTROL_URL and APOLO_WORKER_TOKEN in Codespaces secrets.");
  process.exit(2);
}

async function api(path, body) {
  const response = await fetch(new URL(path, baseUrl), {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`Control API ${response.status}: ${await response.text()}`);
  return response.json();
}

function command(bin, args, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), timeout);
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => { clearTimeout(timer); reject(error); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      else reject(new Error(`${bin} exited ${code}: ${stderr || stdout}`));
    });
  });
}

async function detectEngine() {
  for (const engine of ["docker", "podman"]) {
    try {
      await command(engine, ["info"], 15000);
      return engine;
    } catch {}
  }
  throw new Error("Neither Docker nor Podman is available in this Codespace.");
}

async function execute(job, engine) {
  const p = job.payload || {};
  const name = String(p.name || "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,62}$/.test(name)) throw new Error("Invalid infrastructure name");
  if (job.action === "create") {
    const image = String(p.image || "");
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/.test(image)) throw new Error("Invalid image reference");
    const containerPort = Number(p.container_port);
    if (!Number.isInteger(containerPort) || containerPort < 1 || containerPort > 65535) throw new Error("Invalid container port");
    await command(engine, ["pull", image], 300000);
    const port = 20000 + Math.floor(Math.random() * 20000);
    const run = await command(engine, ["run", "-d", "--name", name, "--restart", "unless-stopped", "-p", `127.0.0.1:${port}:${containerPort}`, image], 120000);
    let gateway = null;
    if (p.hostname) {
      const host = String(p.hostname).toLowerCase();
      if (!/^[a-z0-9][a-z0-9.-]{0,252}$/.test(host) || host.includes("..")) throw new Error("Invalid hostname");
      const config = `server { listen 8080; server_name ${host}; location / { proxy_pass http://127.0.0.1:${port}; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; } }\n`;
      const path = `/tmp/apolo-${name}.conf`;
      await import("node:fs/promises").then(fs => fs.writeFile(path, config, { mode: 0o600 }));
      await command("sudo", ["cp", path, `/etc/nginx/conf.d/apolo-${name}.conf`]);
      await command("sudo", ["nginx", "-t"]);
      await command("sudo", ["nginx", "-s", "reload"]);
      gateway = { hostname: host, port: 8080 };
    }
    return { engine, container_id: run.stdout.split("\n")[0], host_port: port, container_port: containerPort, image, gateway };
  }
  if (job.action === "delete") {
    await command(engine, ["rm", "-f", name], 60000);
    await command("sudo", ["rm", "-f", `/etc/nginx/conf.d/apolo-${name}.conf`]).catch(() => {});
    await command("sudo", ["nginx", "-t"]).then(() => command("sudo", ["nginx", "-s", "reload"])).catch(() => {});
    return { engine, deleted: true };
  }
  if (job.action === "inspect") {
    const result = await command(engine, ["inspect", name], 30000);
    return { engine, inspect: JSON.parse(result.stdout) };
  }
  throw new Error(`Unsupported action: ${job.action}`);
}

async function main() {
  console.log(`APOLO INFRA Codespaces worker ${workerId} starting`);
  while (true) {
    try {
      const engine = await detectEngine();
      await api("/api/worker/heartbeat", { worker_id: workerId, engine, hostname: os.hostname(), status: "online" });
      const claim = await api("/api/worker/claim", { worker_id: workerId });
      if (claim.job) {
        const job = claim.job;
        try {
          const result = await execute(job, engine);
          await api("/api/worker/result", { worker_id: workerId, job_id: job.id, status: "succeeded", result });
          console.log(`Job ${job.id} completed`);
        } catch (error) {
          await api("/api/worker/result", { worker_id: workerId, job_id: job.id, status: "failed", error: String(error.message || error) });
          console.error(`Job ${job.id} failed:`, error);
        }
      }
    } catch (error) {
      console.error("Worker loop error:", error.message || error);
    }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

main();