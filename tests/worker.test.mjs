import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHmac, pbkdf2Sync } from "node:crypto";
import worker from "../order-worker/worker.js";

const adminEmail = "owner@example.test";
const password = "Correct-Horse-123";
const salt = Buffer.from("1234567890abcdef");
const hash = pbkdf2Sync(password, salt, 100000, 32, "sha256");
const passwordHash = `pbkdf2$100000$${salt.toString("base64")}$${hash.toString("base64")}`;
const secret = "test-session-secret-not-a-real-credential";
const origin = "https://shop.example.test";
const env = {
  ADMIN_EMAIL: adminEmail, ADMIN_PASSWORD_HASH: passwordHash, SESSION_SECRET: secret,
  GITHUB_REPO: "owner/mouga-market-store", GITHUB_BRANCH: "main", GITHUB_TOKEN: "fake-token",
  ALLOWED_ORIGINS: origin, SHEETS_WEB_APP_URL: "https://script.example.test", SHEETS_WEBHOOK_SECRET: "test-shared-secret",
  TELEGRAM_BOT_TOKEN: "fake-bot", TELEGRAM_CHAT_ID: "0"
};
let repository;
let requests;
let previousFetch;

function initialRepository() {
  return {
    products: [
      { id: "bag", name: "Bag", category: "accessories", price: 100, stock: 4, status: "active", badge: "", images: ["assets/product.svg"], sizes: [], colors: ["Green"], description: "A useful bag" },
      { id: "draft", name: "Draft", category: "accessories", price: 50, stock: 3, status: "draft", badge: "", images: ["assets/product.svg"], sizes: [], colors: [], description: "Draft" }
    ],
    categories: [{ id: "accessories", name: "Accessories", image: "" }],
    config: { storeName: "Mouga Market", primaryColor: "#17624f", secondaryColor: "#d59b52", font: "system-ui", order_endpoint: "", announcement: { text: "", enabled: false }, slides: [], socialLinks: [] }
  };
}
function githubResponse(name) {
  const content = Buffer.from(JSON.stringify(repository[name], null, 2)).toString("base64");
  return Response.json({ content, sha: `${name}-sha` });
}
beforeEach(() => {
  repository = initialRepository();
  requests = [];
  previousFetch = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("api.github.com")) {
      const name = url.match(/data\/(products|categories|config)\.json/)?.[1];
      if (init.method === "PUT") {
        const body = JSON.parse(init.body);
        if (body.sha !== `${name}-sha`) return Response.json({ message: "Conflict" }, { status: 409 });
        repository[name] = JSON.parse(Buffer.from(body.content, "base64").toString("utf8"));
        return Response.json({ content: { sha: `${name}-sha` } });
      }
      return githubResponse(name);
    }
    if (url.includes("script.example.test")) {
      const body = JSON.parse(init.body);
      assert.equal(body.secret, env.SHEETS_WEBHOOK_SECRET);
      if (body.action === "createOrder") return Response.json({ ok: true });
      if (body.action === "listOrders") return Response.json({ ok: true, orders: [] });
      return Response.json({ ok: true });
    }
    if (url.includes("api.telegram.org")) return Response.json({ ok: true });
    throw new Error(`Unexpected fetch: ${url}`);
  };
});
afterEach(() => { globalThis.fetch = previousFetch; });

async function call(path, { method = "GET", body, token, requestOrigin = origin } = {}) {
  const headers = { Origin: requestOrigin };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await worker.fetch(new Request(`https://worker.example.test${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }), env, { waitUntil(promise) { promise.catch(() => {}); } });
  return { response, data: await response.json() };
}
async function login(email = adminEmail, pass = password) {
  const result = await call("/admin/login", { method: "POST", body: { email, password: pass } });
  return result.data.token;
}
function signedToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${signature}`;
}

test("login rejects wrong email and password and accepts valid credentials", async () => {
  assert.equal((await call("/admin/login", { method: "POST", body: { email: adminEmail, password: "wrong-password" } })).response.status, 401);
  assert.equal((await call("/admin/login", { method: "POST", body: { email: "wrong@example.test", password } })).response.status, 401);
  assert.ok(await login());
});
test("admin validates missing, tampered, forged and expired sessions; /me renews", async () => {
  assert.equal((await call("/admin/me")).response.status, 401);
  assert.equal((await call("/admin/me", { token: "a.b" })).response.status, 401);
  assert.equal((await call("/admin/me", { token: signedToken({ email: adminEmail, exp: 0 }) })).response.status, 401);
  const token = await login();
  assert.equal((await call("/admin/me", { token: `${token}x` })).response.status, 401);
  const renewed = await call("/admin/me", { token });
  assert.equal(renewed.response.status, 200);
  assert.ok(renewed.data.token);
});
test("rejects a foreign browser origin", async () => {
  assert.equal((await call("/admin/me", { requestOrigin: "https://attacker.test" })).response.status, 403);
});
test("content GET and PUT support products, categories and config", async () => {
  const token = await login();
  for (const name of ["products", "categories", "config"]) {
    const current = await call(`/admin/content/${name}`, { token });
    assert.equal(current.response.status, 200);
    assert.ok(current.data.sha);
    const saved = await call(`/admin/content/${name}`, { method: "PUT", token, body: { data: current.data.data, sha: current.data.sha } });
    assert.equal(saved.response.status, 200);
  }
});
test("stale content sha returns 409 and invalid content returns 400", async () => {
  const token = await login();
  const stale = await call("/admin/content/products", { method: "PUT", token, body: { data: repository.products, sha: "old-sha" } });
  assert.equal(stale.response.status, 409);
  const invalid = await call("/admin/content/products", { method: "PUT", token, body: { data: [{ id: "x", status: "maybe" }], sha: "products-sha" } });
  assert.equal(invalid.response.status, 400);
});
test("orders reject bad phone, altered price, excess stock, drafts and missing options", async () => {
  const base = { name: "Test Buyer", phone: "+212612345678", city: "Rabat", address: "1 Test Street", items: [{ id: "bag", quantity: 1, color: "Green" }] };
  assert.equal((await call("/orders", { method: "POST", body: { ...base, phone: "0612345678" } })).response.status, 400);
  assert.equal((await call("/orders", { method: "POST", body: { ...base, items: [{ ...base.items[0], price: 20 }] } })).response.status, 400);
  assert.equal((await call("/orders", { method: "POST", body: { ...base, items: [{ ...base.items[0], quantity: 5 }] } })).response.status, 400);
  assert.equal((await call("/orders", { method: "POST", body: { ...base, items: [{ id: "draft", quantity: 1 }] } })).response.status, 400);
  assert.equal((await call("/orders", { method: "POST", body: { ...base, items: [{ id: "bag", quantity: 1 }] } })).response.status, 400);
});
test("order total comes from the catalog and writes to Sheets before Telegram", async () => {
  const result = await call("/orders", { method: "POST", body: { name: "Test Buyer", phone: "+212612345678", city: "Rabat", address: "1 Test Street", items: [{ id: "bag", quantity: 2, color: "Green" }] } });
  assert.equal(result.response.status, 201);
  const sheetsIndex = requests.findIndex((request) => request.url.includes("script.example.test"));
  const telegramIndex = requests.findIndex((request) => request.url.includes("api.telegram.org"));
  assert.ok(sheetsIndex >= 0 && telegramIndex > sheetsIndex);
  assert.equal(JSON.parse(requests[sheetsIndex].init.body).order.total, 200);
});
test("category deletion is blocked while products reference it", async () => {
  const token = await login();
  const result = await call("/admin/content/categories", { method: "PUT", token, body: { data: [], sha: "categories-sha" } });
  assert.equal(result.response.status, 409);
});
