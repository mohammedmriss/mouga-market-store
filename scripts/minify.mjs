import { cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "dist");
const skippedDirectories = new Set([".git", ".vscode", "dist", "node_modules", "order-worker", "scripts", "tests"]);
const includedExtensions = new Set([".html", ".js", ".css", ".json", ".svg", ".txt", ".xml"]);
const skippedFiles = new Set(["package.json"]);

async function copySite(source) {
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) continue;
    const sourcePath = join(source, entry.name);
    const relativePath = relative(root, sourcePath);
    const outputPath = resolve(output, relativePath);
    if (entry.isDirectory()) {
      await mkdir(outputPath, { recursive: true });
      await copySite(sourcePath);
      continue;
    }
    if (skippedFiles.has(entry.name) || !includedExtensions.has(extname(entry.name).toLowerCase())) continue;
    await mkdir(dirname(outputPath), { recursive: true });
    if (entry.name.endsWith(".css")) {
      const css = await readFile(sourcePath, "utf8");
      const minified = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").replace(/\s*([{}:;,>])\s*/g, "$1").trim();
      await writeFile(outputPath, minified, "utf8");
    } else if (entry.name.endsWith(".html")) {
      const html = await readFile(sourcePath, "utf8");
      await writeFile(outputPath, html.replace(/<!--[\s\S]*?-->/g, "").replace(/>\s+</g, "><").trim(), "utf8");
    } else {
      await cp(sourcePath, outputPath);
    }
  }
}

await mkdir(output, { recursive: true });
await copySite(root);
console.log(`Static production copy created at ${output}`);
