import { readdir, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ignored = new Set([".git", "node_modules", ".wrangler"]);
const patterns = [
  { name: "GitHub personal access token", regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}\b/ },
  { name: "Telegram bot token", regex: /\b\d{7,12}:[A-Za-z0-9_-]{30,}\b/ },
  { name: "Private key block", regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Cloudflare API token assignment", regex: /\b(?:CLOUDFLARE_API_TOKEN|CF_API_TOKEN)\s*=\s*["'][^"']{12,}["']/i },
  { name: "Credential-like URL", regex: /https?:\/\/[^/\s:@]+:[^/\s@]+@/i }
];
const scanExtensions = new Set([".html", ".css", ".js", ".mjs", ".json", ".toml", ".txt", ".md", ".gs", ".ps1", ".xml"]);
const scanNames = new Set([".env", ".env.local", ".dev.vars"]);
const findings = [];
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && ignored.has(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walk(path);
    else if (scanExtensions.has(extname(entry.name).toLowerCase()) || scanNames.has(entry.name)) {
      const content = await readFile(path, "utf8");
      for (const pattern of patterns) if (pattern.regex.test(content)) findings.push(`${path}: possible ${pattern.name}`);
    }
  }
}
await walk(root);
if (findings.length) {
  console.error(`Potential secret values found (${findings.length}):`);
  findings.forEach((finding) => console.error(finding));
  process.exitCode = 1;
} else {
  console.log("Secret scan passed: no recognized credential patterns found.");
}
