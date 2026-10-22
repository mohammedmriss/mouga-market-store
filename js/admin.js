const API = "data/config.json";
const tokenKey = "mouga-admin-session";
let endpoint = "";
let token = localStorage.getItem(tokenKey) || "";
let products = [];
let categories = [];
let allOrders = [];

function message(text) { document.getElementById("admin-message").textContent = text; }
async function config() {
  const response = await fetch(API);
  if (!response.ok) throw new Error("Could not load store settings.");
  const data = await response.json();
  endpoint = data.order_endpoint || "";
  if (!endpoint) throw new Error("Admin API is not configured yet. Set data/config.json order_endpoint after deploying the Worker.");
}
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${endpoint}${path}`, { ...options, headers });
  let body;
  try { body = await response.json(); }
  catch { throw new Error("The server returned an invalid response."); }
  if (response.status === 401) {
    token = ""; localStorage.removeItem(tokenKey); document.getElementById("dashboard").hidden = true; document.getElementById("login-panel").hidden = false;
    throw new Error("Session expired. Please sign in again.");
  }
  if (!response.ok) throw new Error(body.message || `Request failed (${response.status}).`);
  return body;
}
async function loadContent(name) {
  const response = await api(`/admin/content/${name}`);
  return { data: response.data, sha: response.sha };
}
async function saveContent(name, data, sha) {
  return api(`/admin/content/${name}`, { method: "PUT", body: JSON.stringify({ data, sha }) });
}
function splitValues(value) { return value.split(",").map((item) => item.trim()).filter(Boolean); }

document.getElementById("login-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  try {
    await config();
    const result = await api("/admin/login", { method: "POST", body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
    token = result.token; localStorage.setItem(tokenKey, token);
    await enterAdmin();
  } catch (error) { message(error.message); }
});
async function enterAdmin() {
  document.getElementById("login-panel").hidden = true; document.getElementById("dashboard").hidden = false;
  message("Signed in. Loading store data…");
  try { const session = await api("/admin/me"); if (session.token) { token = session.token; localStorage.setItem(tokenKey, token); } await reloadProducts(); await reloadCategories(); await loadAppearance(); message("Admin session active."); await reloadOrders(); }
  catch (error) { message(`Could not load data: ${error.message}. Retry without signing out.`); }
}
async function reloadProducts() {
  const result = await loadContent("products"); products = result.data;
  document.getElementById("product-count").textContent = `${products.length} products`;
  document.getElementById("product-stats").textContent = `${products.filter((product) => product.status === "active").length} active · ${products.filter((product) => product.stock <= 3).length} low-stock (3 or fewer)`;
  const list = document.getElementById("product-list"); list.replaceChildren();
  products.forEach((product) => {
    const item = document.createElement("p");
    item.textContent = `${product.name} — ${product.price} MAD — ${product.status} — stock ${product.stock}`;
    const edit = document.createElement("button"); edit.className = "button button-light"; edit.type = "button"; edit.textContent = "Edit";
    edit.addEventListener("click", () => fillProduct(product));
    const remove = document.createElement("button"); remove.className = "button button-light"; remove.type = "button"; remove.textContent = "Delete";
    remove.addEventListener("click", () => deleteProduct(product.id));
    item.append(" ", edit, " ", remove); list.append(item);
  });
}
function fillProduct(product) {
  const form = document.getElementById("product-form");
  Object.entries(product).forEach(([key, value]) => { if (form.elements[key]) form.elements[key].value = Array.isArray(value) ? value.join(key === "images" ? "\n" : ", ") : value; });
  location.hash = "products-panel";
}
async function deleteProduct(id) {
  if (!confirm(`Delete ${id}?`)) return;
  try { const result = await loadContent("products"); await saveContent("products", result.data.filter((item) => item.id !== id), result.sha); await reloadProducts(); message("Product deleted."); }
  catch (error) { message(error.message); }
}
document.getElementById("product-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  const product = { id: form.get("id"), name: form.get("name"), category: form.get("category"), price: Number(form.get("price")), stock: Number(form.get("stock")), status: form.get("status"), badge: form.get("badge"), images: form.get("images").split(/\r?\n/).map((x) => x.trim()).filter(Boolean), sizes: splitValues(form.get("sizes")), colors: splitValues(form.get("colors")), description: form.get("description") };
  try { const result = await loadContent("products"); const index = result.data.findIndex((item) => item.id === product.id); if (index < 0) result.data.push(product); else result.data[index] = product; await saveContent("products", result.data, result.sha); await reloadProducts(); message("Product saved."); }
  catch (error) { message(error.message); }
});
async function reloadCategories() {
  const result = await loadContent("categories"); categories = result.data;
  const list = document.getElementById("category-list"); list.replaceChildren();
  const select = document.querySelector('#product-form select[name="category"]');
  select.replaceChildren();
  categories.forEach((category) => {
    const option = document.createElement("option"); option.value = category.id; option.textContent = category.name; select.append(option);
    const item = document.createElement("p"); item.textContent = `${category.name} (${category.id})`;
    const rename = document.createElement("button"); rename.type = "button"; rename.className = "button button-light"; rename.textContent = "Rename";
    rename.addEventListener("click", async () => {
      const name = prompt("New category name", category.name);
      if (!name?.trim()) return;
      try { const latest = await loadContent("categories"); const current = latest.data.find((entry) => entry.id === category.id); if (current) current.name = name.trim(); await saveContent("categories", latest.data, latest.sha); await reloadCategories(); message("Category renamed."); }
      catch (error) { message(error.message); }
    });
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "button button-light"; remove.textContent = "Delete";
    remove.addEventListener("click", async () => {
      if (!confirm(`Delete category ${category.name}?`)) return;
      try { const latest = await loadContent("categories"); await saveContent("categories", latest.data.filter((entry) => entry.id !== category.id), latest.sha); await reloadCategories(); message("Category deleted."); }
      catch (error) { message(error.message); }
    });
    const move = (direction) => async () => {
      try {
        const latest = await loadContent("categories");
        const index = latest.data.findIndex((entry) => entry.id === category.id);
        const target = index + direction;
        if (target < 0 || target >= latest.data.length) return;
        [latest.data[index], latest.data[target]] = [latest.data[target], latest.data[index]];
        await saveContent("categories", latest.data, latest.sha); await reloadCategories(); message("Category order saved.");
      } catch (error) { message(error.message); }
    };
    const up = document.createElement("button"); up.type = "button"; up.className = "button button-light"; up.textContent = "Move up"; up.addEventListener("click", move(-1));
    const down = document.createElement("button"); down.type = "button"; down.className = "button button-light"; down.textContent = "Move down"; down.addEventListener("click", move(1));
    item.append(" ", rename, " ", remove, " ", up, " ", down); list.append(item);
  });
}
document.getElementById("category-form").addEventListener("submit", async (event) => {
  event.preventDefault(); const form = new FormData(event.currentTarget);
  try { const cats = await loadContent("categories"); if (cats.data.some((item) => item.id === form.get("id"))) throw new Error("Category ID already exists."); cats.data.push({ id: form.get("id"), name: form.get("name"), image: "" }); await saveContent("categories", cats.data, cats.sha); await reloadCategories(); await reloadProducts(); message("Category added."); }
  catch (error) { message(error.message); }
});
async function reloadOrders() {
  try {
    const result = await api("/admin/orders");
    allOrders = result.orders;
    const active = allOrders.filter((order) => order.status !== "cancelled");
    const revenue = active.reduce((sum, order) => sum + Number(order.total || 0), 0);
    document.getElementById("sales-stats").textContent = `Orders: ${allOrders.length} · Revenue: ${revenue} MAD · Pending: ${allOrders.filter((order) => ["new", "confirmed"].includes(order.status)).length}`;
    const sellerCounts = new Map();
    const dailyCounts = new Map();
    allOrders.forEach((order) => {
      const day = String(order.createdAt || "").slice(0, 10);
      if (day) dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
      (Array.isArray(order.items) ? order.items : []).forEach((item) => sellerCounts.set(item.name, (sellerCounts.get(item.name) || 0) + Number(item.quantity || 0)));
    });
    const bestSeller = [...sellerCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const recentDays = [...dailyCounts.entries()].sort((a, b) => a[0].localeCompare(b[0])).slice(-7).map(([day, count]) => `${day}: ${count}`).join(" · ") || "No order history";
    document.getElementById("analytics-summary").textContent = `Average order: ${active.length ? (revenue / active.length).toFixed(2) : "0.00"} MAD · Best seller: ${bestSeller ? `${bestSeller[0]} (${bestSeller[1]})` : "—"} · Orders per day: ${recentDays}`;
    const recent = document.getElementById("recent-orders"); recent.replaceChildren();
    allOrders.slice(-5).reverse().forEach((order) => { const item = document.createElement("p"); item.textContent = `${String(order.id).slice(0, 8)} · ${order.name} · ${order.total} MAD · ${order.status}`; recent.append(item); });
    renderOrders();
  } catch (error) { message(error.message); }
}
function renderOrders() {
    const list = document.getElementById("orders-list"); list.replaceChildren();
    const statusFilter = document.getElementById("order-status-filter").value;
    const query = document.getElementById("order-search").value.trim().toLowerCase();
    allOrders.filter((order) => (!statusFilter || order.status === statusFilter) && (!query || `${order.name} ${order.phone}`.toLowerCase().includes(query))).forEach((order) => {
      const card = document.createElement("article"); card.className = "admin-panel";
      const title = document.createElement("strong"); title.textContent = `${String(order.id).slice(0, 8)} — ${order.name} — ${order.total} MAD`;
      const details = document.createElement("p"); details.textContent = `${order.phone} · ${order.city} · ${order.address || ""} · ${order.itemsSummary || ""}`;
      const phoneLink = document.createElement("a"); phoneLink.href = `tel:${String(order.phone || "").replace(/[^\d+]/g, "")}`; phoneLink.textContent = "Call";
      const whatsappNumber = String(order.phone || "").replace(/\D/g, "");
      const whatsappLink = document.createElement("a"); whatsappLink.href = `https://wa.me/${whatsappNumber}`; whatsappLink.target = "_blank"; whatsappLink.rel = "noopener noreferrer"; whatsappLink.textContent = "WhatsApp";
      const status = document.createElement("select"); status.setAttribute("aria-label", "Order status");
      ["new", "confirmed", "shipped", "delivered", "cancelled"].forEach((value) => { const option = document.createElement("option"); option.value = value; option.textContent = value; option.selected = value === order.status; status.append(option); });
      status.addEventListener("change", async () => { try { await api("/admin/orders", { method: "PATCH", body: JSON.stringify({ id: order.id, status: status.value }) }); order.status = status.value; message("Order status updated."); renderOrders(); } catch (error) { message(error.message); } });
      card.append(title, details, phoneLink, document.createTextNode(" · "), whatsappLink, document.createTextNode(" · "), status); list.append(card);
    });
}
document.getElementById("reload-orders").addEventListener("click", reloadOrders);
document.getElementById("order-status-filter").addEventListener("change", renderOrders);
document.getElementById("order-search").addEventListener("input", renderOrders);
document.getElementById("export-orders").addEventListener("click", () => {
  const rows = [["id", "createdAt", "status", "name", "phone", "city", "address", "itemsSummary", "total"], ...allOrders.map((order) => [order.id, order.createdAt, order.status, order.name, order.phone, order.city, order.address, order.itemsSummary, order.total])];
  const csv = rows.map((row) => row.map((cell) => {
    let text = String(cell ?? "");
    if (/^[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }).join(",")).join("\r\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" })); link.download = "orders.csv"; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 0);
});

async function loadAppearance() {
  const { data, sha } = await loadContent("config"); const form = document.getElementById("appearance-form");
  form.elements.storeName.value = data.storeName || "";
  form.elements.logoUrl.value = data.logoUrl || "";
  form.elements.primaryColor.value = data.primaryColor || "#17624f";
  form.elements.secondaryColor.value = data.secondaryColor || "#d59b52";
  form.elements.font.value = data.font || "system-ui";
  form.elements.announcementText.value = data.announcement?.text || "";
  form.elements.announcementEnabled.checked = Boolean(data.announcement?.enabled);
  form.elements.phone.value = data.phone || "";
  form.elements.whatsapp.value = data.whatsapp || "";
  form.elements.email.value = data.email || "";
  form.elements.footerText.value = data.footerText || "";
  form.elements.facebookPixelId.value = data.facebookPixelId || "";
  form.elements.slides.value = JSON.stringify(data.slides || [], null, 2);
  form.elements.showBenefits.checked = data.sections?.benefits !== false;
  form.elements.showAbout.checked = data.sections?.about !== false;
  form.elements.showContact.checked = data.sections?.contact !== false;
  form.dataset.sha = sha;
  previewAppearance();
}
function previewAppearance() {
  const form = document.getElementById("appearance-form");
  const preview = document.getElementById("appearance-preview");
  preview.textContent = `${form.elements.storeName.value || "Store name"} — ${form.elements.announcementText.value || "Announcement preview"}`;
  preview.style.color = form.elements.primaryColor.value;
  preview.style.borderColor = form.elements.secondaryColor.value;
}
document.getElementById("appearance-form").addEventListener("input", previewAppearance);
document.getElementById("appearance-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget); const element = event.currentTarget;
  try {
    const current = await loadContent("config");
    const data = current.data;
    data.storeName = form.get("storeName"); data.logoUrl = form.get("logoUrl"); data.primaryColor = form.get("primaryColor"); data.secondaryColor = form.get("secondaryColor"); data.font = form.get("font");
    data.announcement = { text: form.get("announcementText"), enabled: form.get("announcementEnabled") === "on" };
    data.phone = form.get("phone"); data.whatsapp = form.get("whatsapp"); data.email = form.get("email"); data.footerText = form.get("footerText"); data.facebookPixelId = form.get("facebookPixelId");
    data.slides = JSON.parse(form.get("slides") || "[]");
    data.sections = { benefits: form.get("showBenefits") === "on", about: form.get("showAbout") === "on", contact: form.get("showContact") === "on" };
    const saved = await saveContent("config", data, current.sha); element.dataset.sha = saved.sha; message("Appearance saved.");
  } catch (error) { message(error instanceof SyntaxError ? "Hero slides must be a valid JSON array." : error.message); }
});
document.querySelectorAll(".logout").forEach((button) => button.addEventListener("click", () => { token = ""; localStorage.removeItem(tokenKey); document.getElementById("dashboard").hidden = true; document.getElementById("login-panel").hidden = false; message("Signed out."); }));
document.querySelector('[data-load="products"]').addEventListener("click", () => reloadProducts().catch((error) => message(error.message)));
document.getElementById("retry-admin").addEventListener("click", enterAdmin);
document.getElementById("retry-session").addEventListener("click", async () => {
  try { await config(); await enterAdmin(); document.getElementById("retry-session").hidden = true; }
  catch (error) { message(`Retry failed: ${error.message}. Your saved session was kept.`); }
});
(async () => {
  if (!token) return;
  try { await config(); await enterAdmin(); }
  catch (error) { document.getElementById("retry-session").hidden = false; message(`${error.message} Your saved session was kept. Retry when the connection is restored.`); }
})();
