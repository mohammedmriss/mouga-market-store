import { createInterface } from "node:readline";
import { randomBytes, pbkdf2 as pbkdf2Callback } from "node:crypto";
import { promisify } from "node:util";

const pbkdf2 = promisify(pbkdf2Callback);
const input = process.stdin;
const output = process.stdout;

function readHidden(prompt) {
  return new Promise((resolve, reject) => {
    const terminal = Boolean(input.isTTY && output.isTTY && input.setRawMode);
    if (!terminal) return reject(new Error("Run this command in an interactive terminal."));
    output.write(prompt);
    input.setRawMode(true);
    input.resume();
    let answer = "";
    const onData = (chunk) => {
      for (const char of chunk.toString("utf8")) {
        if (char === "\u0003") { cleanup(); reject(new Error("Cancelled.")); return; }
        if (char === "\r" || char === "\n") { cleanup(); output.write("\n"); resolve(answer); return; }
        if (char === "\u007f" || char === "\b") answer = answer.slice(0, -1);
        else answer += char;
      }
    };
    const cleanup = () => { input.off("data", onData); input.setRawMode(false); input.pause(); };
    input.on("data", onData);
  });
}

try {
  const password = await readHidden("Choose admin password (at least 10 characters; input hidden): ");
  if (password.length < 10) throw new Error("Password must contain at least 10 characters.");
  const salt = randomBytes(16);
  const hash = await pbkdf2(password, salt, 100000, 32, "sha256");
  const sessionSecret = randomBytes(48).toString("base64url");
  console.log(`ADMIN_PASSWORD_HASH=pbkdf2$100000$${salt.toString("base64")}$${hash.toString("base64")}`);
  console.log(`SESSION_SECRET=${sessionSecret}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
