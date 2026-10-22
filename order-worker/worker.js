const SHEET_HEADERS = ["id", "createdAt", "status", "name", "phone", "city", "items", "itemsSummary", "total"];
const ORDER_STATUSES = ["new", "confirmed", "shipped", "delivered", "cancelled"];
const CONTENT_FILES = new Set(["products", "categories", "config"]);

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers } });
}
async function readJson(request, limit) {
  const declaredLength = Number(request.headers.get("Content-Length") || 0);
  if (declaredLength > limit) throw new Error("payload_too_large");
  if (!request.body) throw new Error("invalid_request");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel();
      throw new Error("payload_too_large");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  chunks.forEach((chunk) => { bytes.set(chunk, offset); offset += chunk.byteLength; });
  const text = new TextDecoder().decode(bytes);
  try { return JSON.parse(text); } catch { throw new Error("invalid_request"); }
}
async function rateLimit(kv, key, maximum, windowSeconds) {
  if (!kv) return false;
  const current = Number(await kv.get(key) || 0);
  if (current >= maximum) return true;
  await kv.put(key, String(current + 1), { expirationTtl: windowSeconds });
  return false;
}

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin");
  const allowed = (env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim()).filter(Boolean);
  if (origin && !allowed.includes(origin)) return null;
  return origin ? { "Access-Control-Allow-Origin": origin, "Vary": "Origin", "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" } : { "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,OPTIONS", "Access-Control-Allow-Headers": "Content-Type,Authorization" };
}

function decodeBase64(value) {
  const binary = atob(value.replace(/\s/g, ""));
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
function encodeBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function fromBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value)));
}
function constantTimeEqual(left, right) {
  const a = new TextEncoder().encode(left);
  const b = new TextEncoder().encode(right);
  let difference = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) difference |= (a[i % (a.length || 1)] || 0) ^ (b[i % (b.length || 1)] || 0);
  return difference === 0;
}
async function issueToken(email, env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64Url(new TextEncoder().encode(JSON.stringify({ email, iat: now, exp: now + 14 * 86400 })));
  const signature = base64Url(await hmac(env.SESSION_SECRET, payload));
  return `${payload}.${signature}`;
}
async function validToken(request, env) {
  const authorization = request.headers.get("Authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return false;
  const expected = base64Url(await hmac(env.SESSION_SECRET, payload));
  if (!constantTimeEqual(signature, expected)) return false;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
    return data.email === env.ADMIN_EMAIL && Number.isInteger(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch { return false; }
}

async function verifyPassword(password, encoded) {
  const [scheme, iterationsText, saltText, expectedText] = String(encoded || "").split("$");
  const iterations = Number(iterationsText);
  if (scheme !== "pbkdf2" || !Number.isInteger(iterations) || iterations < 100000 || iterations > 1000000 || !saltText || !expectedText) return false;
  try {
    const salt = Uint8Array.from(atob(saltText), (character) => character.charCodeAt(0));
    const expected = Uint8Array.from(atob(expectedText), (character) => character.charCodeAt(0));
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    const actual = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, expected.length * 8));
    return constantTimeEqual(base64Url(actual), base64Url(expected));
  } catch { return false; }
}

async function getContent(name, env) {
  if (!CONTENT_FILES.has(name)) throw new Error("not_found");
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/data/${name}.json?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "User-Agent": "mouga-market-worker" } });
  if (!response.ok) throw new Error("upstream");
  const file = await response.json();
  return { data: JSON.parse(decodeBase64(file.content)), sha: file.sha };
}
async function putContent(name, data, sha, env) {
  if (!CONTENT_FILES.has(name)) throw new Error("not_found");
  validateContent(name, data);
  if (name === "products") {
    const categories = await getContent("categories", env);
    const categoryIds = new Set(categories.data.map((category) => category.id));
    if (data.some((product) => !categoryIds.has(product.category))) throw new Error("invalid");
  }
  if (name === "categories") {
    const products = await getContent("products", env);
    const nextIds = new Set(data.map((category) => category.id));
    if (products.data.some((product) => !nextIds.has(product.category))) throw new Error("category_in_use");
  }
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/contents/data/${name}.json`;
  const response = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: "application/vnd.github+json", "Content-Type": "application/json", "User-Agent": "mouga-market-worker" },
    body: JSON.stringify({ message: `Update ${name} via Mouga Market admin`, content: encodeBase64(JSON.stringify(data, null, 2) + "\n"), sha, branch: env.GITHUB_BRANCH })
  });
  if (response.status === 409 || response.status === 422) throw new Error("conflict");
  if (!response.ok) throw new Error("upstream");
  return response.json();
}
function validUrl(value) {
  if (typeof value !== "string" || !value) return false;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}
function validateContent(name, data) {
  const fail = () => { throw new Error("invalid"); };
  if (name === "products") {
    if (!Array.isArray(data) || data.length > 2000) fail();
    const ids = new Set();
    for (const p of data) {
      if (!p || typeof p.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(p.id) || ids.has(p.id) ||
        typeof p.name !== "string" || !p.name.trim() || p.name.length > 120 ||
        typeof p.category !== "string" || p.category.length > 80 ||
        !Number.isFinite(p.price) || p.price < 0 || p.price > 10000000 ||
        !Number.isInteger(p.stock) || p.stock < 0 || p.stock > 1000000 ||
        !["draft", "active"].includes(p.status) || typeof p.description !== "string" || p.description.length > 1500 ||
        !Array.isArray(p.images) || p.images.length > 12 || p.images.some((url) => !validUrl(url) && !/^assets\/[a-zA-Z0-9._/-]{1,180}$/.test(url)) ||
        !Array.isArray(p.sizes) || p.sizes.length > 30 || p.sizes.some((x) => typeof x !== "string" || x.length > 50) ||
        !Array.isArray(p.colors) || p.colors.length > 30 || p.colors.some((x) => typeof x !== "string" || x.length > 50)) fail();
      ids.add(p.id);
    }
  } else if (name === "categories") {
    if (!Array.isArray(data) || data.length > 100) fail();
    const ids = new Set();
    for (const c of data) {
      if (!c || typeof c.id !== "string" || !/^[a-z0-9-]{1,80}$/.test(c.id) || ids.has(c.id) ||
          typeof c.name !== "string" || !c.name.trim() || c.name.length > 80 ||
          (c.image && !validUrl(c.image) && !/^assets\/[a-zA-Z0-9._/-]{1,180}$/.test(c.image))) fail();
      ids.add(c.id);
    }
  } else if (name === "config") {
    if (!data || typeof data !== "object" || Array.isArray(data) ||
        typeof data.storeName !== "string" || data.storeName.length > 100 ||
        !/^#[0-9a-f]{6}$/i.test(data.primaryColor) || !/^#[0-9a-f]{6}$/i.test(data.secondaryColor) ||
        typeof data.order_endpoint !== "string" || data.order_endpoint.length > 300 ||
        (data.order_endpoint && (!validUrl(data.order_endpoint) || new URL(data.order_endpoint).protocol !== "https:")) ||
        !["system-ui", "Arial", "Georgia", "Tahoma"].includes(data.font) ||
        typeof data.announcement?.text !== "string" || data.announcement.text.length > 200 ||
        typeof data.announcement.enabled !== "boolean" ||
        (data.logoUrl && !validUrl(data.logoUrl)) ||
        (data.slides && (!Array.isArray(data.slides) || data.slides.length > 10 || data.slides.some((s) => !s || typeof s.title !== "string" || s.title.length > 120 || (s.description && (typeof s.description !== "string" || s.description.length > 300)) || (s.buttonText && (typeof s.buttonText !== "string" || s.buttonText.length > 80)) || (s.image && !validUrl(s.image)) || (s.buttonLink && !validUrl(s.buttonLink) && !/^(#|\/(?!\/)|[a-zA-Z0-9])[a-zA-Z0-9_./?=&%-]{0,180}$/.test(s.buttonLink)))) ||
        (data.socialLinks && (!Array.isArray(data.socialLinks) || data.socialLinks.length > 10 || data.socialLinks.some((s) => !s || !validUrl(s.url)))) ||
        (data.sections && (!data.sections || typeof data.sections !== "object" || Array.isArray(data.sections) || ["benefits", "about", "contact"].some((key) => typeof data.sections[key] !== "boolean"))) ||
        ["phone", "whatsapp", "email", "footerText", "facebookPixelId"].some((key) => data[key] !== undefined && (typeof data[key] !== "string" || data[key].length > 250))) fail();
  }
  if (new TextEncoder().encode(JSON.stringify(data)).length > 200000) fail();
}

async function postToSheets(env, payload) {
  const response = await fetch(env.SHEETS_WEB_APP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, secret: env.SHEETS_WEBHOOK_SECRET }), redirect: "follow"
  });
  if (!response.ok) throw new Error("sheets");
  const result = await response.json();
  if (!result.ok) throw new Error("sheets");
  return result;
}

async function handleOrder(request, env, ctx) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await rateLimit(env.LOGIN_KV, `orders:${ip}`, 20, 900)) return json({ message: "صيفطتي طلبات بزاف. عاود من بعد." }, 429);
  const body = await readJson(request, 20000);
  if (!body || typeof body !== "object" || Array.isArray(body)) return json({ message: "تفاصيل الطلب غير صحيحة." }, 400);
  if (body.website) return json({ ok: true });
  if (typeof body.name !== "string" || !body.name.trim() || body.name.length > 100 ||
      typeof body.address !== "string" || !body.address.trim() || body.address.length > 200 ||
      typeof body.city !== "string" || !body.city.trim() || body.city.length > 80 ||
      !/^\+212[5-7]\d{8}$/.test(body.phone) || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 20) {
    return json({ message: "راجع الاسم ورقم الهاتف والعنوان والمنتجات." }, 400);
  }
  let authoritative;
  try { authoritative = (await getContent("products", env)).data; } catch { return json({ message: "تعذر التأكد من المنتجات. عاود المحاولة." }, 502); }
  const items = [];
  for (const requested of body.items) {
    if (!requested || typeof requested.id !== "string" || !Number.isInteger(requested.quantity) || requested.quantity < 1 || requested.quantity > 20) return json({ message: "تفاصيل أحد المنتجات غير صحيحة." }, 400);
    const product = authoritative.find((item) => item.id === requested.id && item.status === "active");
    if (!product) return json({ message: "شي منتج ما بقاش متوفر." }, 400);
    if (requested.quantity > product.stock) return json({ message: `الكمية المتوفرة من ${product.name} ما كافياش.` }, 400);
    if ((product.sizes?.length && !product.sizes.includes(requested.size)) || (product.colors?.length && !product.colors.includes(requested.color)) ||
        (!product.sizes?.length && requested.size) || (!product.colors?.length && requested.color) ||
        (requested.size && (typeof requested.size !== "string" || requested.size.length > 50)) ||
        (requested.color && (typeof requested.color !== "string" || requested.color.length > 50))) return json({ message: "اختار المقاس واللون الصحيحين." }, 400);
    if (requested.price !== undefined && requested.price !== product.price) return json({ message: "الثمن تبدل. حدّث الصفحة وعاود الطلب." }, 400);
    items.push({ id: product.id, name: product.name, price: product.price, quantity: requested.quantity, size: requested.size || "", color: requested.color || "" });
  }
  const total = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const order = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), status: "new", name: body.name.trim(), phone: body.phone, city: body.city.trim(), address: body.address.trim(), items, itemsSummary: items.map((item) => `${item.name} × ${item.quantity}${item.size ? ` (${item.size})` : ""}${item.color ? ` (${item.color})` : ""}`).join(", "), total };
  try { await postToSheets(env, { action: "createOrder", order }); } catch { return json({ message: "ما تسجلش الطلب دابا. عاود المحاولة من بعد." }, 502); }
  ctx.waitUntil(sendTelegram(env, order));
  return json({ ok: true, id: order.id }, 201);
}
async function sendTelegram(env, order) {
  try {
    const lines = [`طلب ${order.id.slice(0, 8)}`, `${order.name} — ${order.phone}`, `${order.city}: ${order.address}`, order.itemsSummary, `المجموع: ${order.total} درهم`];
    const response = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: lines.join("\n") }) });
    if (!response.ok) console.error("Telegram notification failed", response.status);
  } catch { console.error("Telegram notification failed"); }
}
async function handleLogin(request, env) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  if (await rateLimit(env.LOGIN_KV, `login:${ip}`, 5, 900)) return json({ message: "Too many attempts. Try again later." }, 429);
  const body = await readJson(request, 8000);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const passwordOk = await verifyPassword(password, env.ADMIN_PASSWORD_HASH);
  const emailOk = constantTimeEqual(email, String(env.ADMIN_EMAIL || "").toLowerCase());
  await new Promise((resolve) => setTimeout(resolve, 350));
  if (!passwordOk || !emailOk) return json({ message: "Invalid email or password." }, 401);
  if (env.LOGIN_KV) await env.LOGIN_KV.delete(`login:${ip}`);
  return json({ token: await issueToken(env.ADMIN_EMAIL, env) });
}
async function handleAdmin(request, env, path) {
  if (path === "/admin/login" && request.method === "POST") return handleLogin(request, env);
  if (!await validToken(request, env)) return json({ message: "Unauthorized." }, 401);
  if (path === "/admin/me" && request.method === "GET") return json({ ok: true, token: await issueToken(env.ADMIN_EMAIL, env) });
  const contentMatch = path.match(/^\/admin\/content\/([a-z]+)$/);
  if (contentMatch && request.method === "GET") {
    const result = await getContent(contentMatch[1], env);
    return json(result);
  }
  if (contentMatch && request.method === "PUT") {
    const body = await readJson(request, 210000);
    if (!body || typeof body.sha !== "string") return json({ message: "Invalid request." }, 400);
    const result = await putContent(contentMatch[1], body.data, body.sha, env);
    return json({ ok: true, sha: result.content.sha });
  }
  if (path === "/admin/orders" && request.method === "GET") {
    const result = await postToSheets(env, { action: "listOrders" });
    return json({ orders: result.orders });
  }
  if (path === "/admin/orders" && request.method === "PATCH") {
    const body = await readJson(request, 8000);
    if (typeof body.id !== "string" || !ORDER_STATUSES.includes(body.status)) return json({ message: "Invalid order update." }, 400);
    const result = await postToSheets(env, { action: "updateOrder", id: body.id, status: body.status });
    return json(result);
  }
  return json({ message: "Not found." }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const headers = corsHeaders(request, env);
    if (!headers) return json({ message: "Origin not allowed." }, 403);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    const url = new URL(request.url);
    try {
      let response;
      if (url.pathname === "/orders" && request.method === "POST") response = await handleOrder(request, env, ctx);
      else if (url.pathname.startsWith("/admin/")) response = await handleAdmin(request, env, url.pathname);
      else response = json({ message: "Not found." }, 404);
      const result = new Response(response.body, response);
      Object.entries(headers).forEach(([key, value]) => result.headers.set(key, value));
      return result;
    } catch (error) {
      if (error.message === "conflict") return json({ message: "The file changed, reload the page." }, 409, headers);
      if (error.message === "invalid") return json({ message: "Invalid content schema." }, 400, headers);
      if (error.message === "category_in_use") return json({ message: "Cannot remove a category used by products." }, 409, headers);
      if (error.message === "not_found") return json({ message: "Not found." }, 404, headers);
      if (error.message === "invalid_request") return json({ message: "Invalid JSON request." }, 400, headers);
      if (error.message === "payload_too_large") return json({ message: "Request body is too large." }, 413, headers);
      console.error("Request failed", error);
      return json({ message: "Internal error." }, 500, headers);
    }
  }
};
