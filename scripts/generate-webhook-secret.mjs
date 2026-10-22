import { randomBytes } from "node:crypto";

const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
let secret = "";
while (secret.length < 48) {
  for (const byte of randomBytes(64)) {
    if (byte < 248) secret += alphabet[byte % alphabet.length];
    if (secret.length === 48) break;
  }
}
console.log(secret);
