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
  const requested = process.env.APOLO_CONTAINER_ENGINE;
  const engines = requested ? [requested] : ["docker", "podman"];
  for (const engine of engines) {
    if (engine !== "docker" && engine !== "podman") throw new Error("APOLO_CONTAINER_ENGINE must be docker or podman");
    try {
      await command(engine, ["info"], 15000);
      return engine;
    } catch {}
  }
  throw new Error("Neither Docker nor Podman is available in this Codespace.");
}

async function updateGatewayRoute(name, port, remove = false) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const stateDir = path.join(process.cwd(), ".apolo");
  const stateFile = path.join(stateDir, "gateway-routes.json");
  await fs.mkdir(stateDir, { recursive: true });
  let routes = {};
  try { routes = JSON.parse(await fs.readFile(stateFile, "utf8")); } catch {}
  if (remove) delete routes[name]; else routes[name] = port;
  const locations = Object.entries(routes).map(([routeName, routePort]) =>
    `location ^~ /apps/${routeName}/ { rewrite ^/apps/${routeName}/(.*)$ /$1 break; proxy_pass http://127.0.0.1:${routePort}; proxy_set_header Host $host; proxy_set_header X-Real-IP $remote_addr; proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for; }`
  ).join("\\n");
  const config = `server { listen 8080 default_server; server_name _; ${locations} location / { return 404; } }\\n`;
  const temporary = `/tmp/apolo-gateway-${process.pid}.conf`;
  const target = "/etc/nginx/conf.d/apolo-gateway.conf";
  const nginxConfig = process.env.APOLO_NGINX_CONFIG;
  const nginxArgs = nginxConfig ? ["-c", nginxConfig] : [];
  let previous = null;
  try { previous = await fs.readFile(target, "utf8"); } catch {}
  await fs.writeFile(temporary, config, { mode: 0o600 });
  await command("sudo", ["cp", temporary, target]);
  try {
    await command("sudo", ["nginx", "-t", ...nginxArgs]);
    await command("sudo", ["nginx", "-s", "reload", ...nginxArgs]).catch(() => command("sudo", ["nginx", ...nginxArgs]));
    await fs.writeFile(stateFile, JSON.stringify(routes, null, 2));
  } catch (error) {
    if (previous === null) await command("sudo", ["rm", "-f", target]).catch(() => {});
    else {
      await fs.writeFile(temporary, previous, { mode: 0o600 });
      await command("sudo", ["cp", temporary, target]);
    }
    await command("sudo", ["nginx", "-t", ...nginxArgs]).then(() => command("sudo", ["nginx", "-s", "reload", ...nginxArgs])).catch(() => {});
    throw error;
  }
  return { port: 8080, path: `/apps/${name}/` };
}

async function restoreGatewayRoutes(engine) {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const stateFile = path.join(process.cwd(), ".apolo", "gateway-routes.json");
  let routes;
  try { routes = JSON.parse(await fs.readFile(stateFile, "utf8")); } catch { return; }
  for (const [name, port] of Object.entries(routes)) {
    try {
      const inspect = await command(engine, ["inspect", name], 30000);
      const container = JSON.parse(inspect.stdout)[0];
      if (container?.State?.Status !== "running") await command(engine, ["start", name], 60000);
      await updateGatewayRoute(name, Number(port));
    } catch (error) {
      console.error(`Could not restore ${name}; removing stale gateway route:`, error.message || error);
      await updateGatewayRoute(name, 0, true).catch(() => {});
    }
  }
}

async function buildUploadedSource(engine, name, archiveBase64) {
  if (typeof archiveBase64 !== "string" || archiveBase64.length > 4_200_000) throw new Error("Source ZIP inválido ou maior que o limite permitido.");
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const osTmp = await import("node:os");
  const workDir = await fs.mkdtemp(path.join(osTmp.tmpdir(), "apolo-source-"));
  const archive = path.join(workDir, "source.zip");
  const context = path.join(workDir, "context");
  await fs.mkdir(context);
  try {
    await fs.writeFile(archive, Buffer.from(archiveBase64, "base64"));
    const listing = await command("unzip", ["-Z1", archive], 15000);
    const entries = listing.stdout.split("\\n").filter(Boolean);
    if (!entries.length || entries.length > 5000) throw new Error("ZIP vazio ou com quantidade excessiva de arquivos.");
    for (const entry of entries) {
      const normalized = entry.replace(/\\\\/g, "/");
      if (normalized.startsWith("/") || normalized.split("/").some(part => part === "..") || /^[a-zA-Z]:/.test(normalized)) {
        throw new Error("O ZIP contém caminhos inseguros.");
      }
    }
    await command("unzip", ["-q", archive, "-d", context], 60000);
    let dockerfile = path.join(context, "Dockerfile");
    try { await fs.access(dockerfile); }
    catch {
      const files = await fs.readdir(context);
      if (files.includes("package.json")) {
        const pkg = JSON.parse(await fs.readFile(path.join(context, "package.json"), "utf8"));
        if (!pkg.scripts?.start) throw new Error("package.json precisa definir scripts.start ou inclua um Dockerfile.");
        const lock = files.includes("package-lock.json");
        const install = lock ? "npm ci --omit=dev" : "npm install --omit=dev";
        await fs.writeFile(dockerfile, `FROM node:22-alpine\\nWORKDIR /app\\nCOPY package*.json ./\\nRUN ${install}\\nCOPY . .\\nENV PORT=8080\\nEXPOSE 8080\\nCMD ["npm","start"]\\n`);
      } else if (files.includes("requirements.txt") && (files.includes("main.py") || files.includes("app.py"))) {
        const module = files.includes("main.py") ? "main:app" : "app:app";
        await fs.writeFile(dockerfile, `FROM python:3.12-slim\\nWORKDIR /app\\nCOPY requirements.txt ./\\nRUN pip install --no-cache-dir -r requirements.txt uvicorn\\nCOPY . .\\nEXPOSE 8000\\nCMD ["uvicorn","${module}","--host","0.0.0.0","--port","8000"]\\n`);
      } else if (files.includes("index.html")) {
        await fs.writeFile(dockerfile, "FROM nginx:alpine\\nCOPY . /usr/share/nginx/html/\\nEXPOSE 80\\n");
      } else {
        throw new Error("Não encontrei Dockerfile, package.json com scripts.start, requirements.txt com main.py/app.py ou index.html.");
      }
    }
    const image = `apolo-build/${name.toLowerCase()}:latest`;
    await command(engine, ["build", "-t", image, context], 600000);
    return image;
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

async function detectContainerPort(engine, image) {
  const inspected = await command(engine, ["image", "inspect", "--format", "{{json .Config.ExposedPorts}}", image], 30000);
  let exposed = {};
  try { exposed = JSON.parse(inspected.stdout || "{}") || {}; } catch {}
  const ports = Object.keys(exposed)
    .filter(key => key.endsWith("/tcp"))
    .map(key => Number(key.split("/")[0]))
    .filter(port => Number.isInteger(port) && port > 0 && port <= 65535)
    .sort((a,b)=>a-b);
  if (ports.length) return ports[0];
  const lower = image.toLowerCase();
  if (/(^|[/:-])(nginx|httpd|apache|caddy|traefik)([:@]|$)/.test(lower)) return 80;
  return 8080;
}

async function execute(job, engine) {
  const p = job.payload || {};
  const name = String(p.name || "");
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,62}$/.test(name)) throw new Error("Invalid infrastructure name");
  if (job.action === "create") {
    let image = String(p.image || "");
    if (p.source_archive_base64) image = await buildUploadedSource(engine, name, p.source_archive_base64);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]{0,254}$/.test(image)) throw new Error("Invalid image reference");
    if (!p.source_archive_base64) await command(engine, ["pull", image], 300000);
    const containerPort = await detectContainerPort(engine, image);
    await command(engine, [ "rm", "-f", name ], 30000).catch(() => {});
    const run = await command(engine, [ "run", "-d", "--name", name, "--restart", "unless-stopped", "--memory", "1g", "--cpus", "1", "--pids-limit", "256", "-p", `127.0.0.1::${containerPort}/tcp`, image ], 120000);
    let mapped = await command(engine, ["port", name, `${containerPort}/tcp`], 30000);
    const hostPortMatch = mapped.stdout.match(/:(\\d+)\\s*$/m);
    if (!hostPortMatch) {
      await command(engine, ["rm", "-f", name], 30000).catch(() => {});
      throw new Error("O runtime não informou a porta dinâmica atribuída ao container.");
    }
    const hostPort = Number(hostPortMatch[1]);
    const gateway = await updateGatewayRoute(name, hostPort);
    const codespaceName = process.env.CODESPACE_NAME || "";
    const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";
    gateway.url = codespaceName ? `https://${codespaceName}-8080.${forwardingDomain}${gateway.path}` : null;
    return { engine, container_id: run.stdout.split("\\n")[0], host_port: hostPort, container_port: containerPort, image, gateway };
  }
  if (job.action === "delete") {
    await command(engine, ["rm", "-f", name], 60000);
    await updateGatewayRoute(name, 0, true);
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
  let gatewayRestored = false;
  while (true) {
    try {
      const engine = await detectEngine();
      if (!gatewayRestored) {
        await restoreGatewayRoutes(engine);
        gatewayRestored = true;
      }
      const codespaceName = process.env.CODESPACE_NAME || "";
      const forwardingDomain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN || "app.github.dev";
      const gatewayUrl = codespaceName ? `https://${codespaceName}-8080.${forwardingDomain}` : null;
      await api("/api/worker/heartbeat", { worker_id: workerId, engine, hostname: os.hostname(), gateway_url: gatewayUrl, status: "online" });
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
