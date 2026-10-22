const HEADERS = ["id", "createdAt", "status", "name", "phone", "city", "items", "itemsSummary", "total"];
const STATUSES = ["new", "confirmed", "shipped", "delivered", "cancelled"];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    const secret = PropertiesService.getScriptProperties().getProperty("WORKER_SHARED_SECRET");
    if (!secret || !body.secret || !constantTimeEqual(String(body.secret), secret)) return output({ ok: false, message: "Unauthorized" }, 401);
    if (body.action === "createOrder") return createOrder(body.order);
    if (body.action === "listOrders") return listOrders();
    if (body.action === "updateOrder") return updateOrder(body.id, body.status);
    return output({ ok: false, message: "Unknown action" }, 400);
  } catch (error) {
    console.error("Request failed", error);
    return output({ ok: false, message: "Request failed" }, 500);
  }
}

function output(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function constantTimeEqual(left, right) {
  let diff = left.length ^ right.length;
  const size = Math.max(left.length, right.length);
  for (let i = 0; i < size; i++) diff |= (left.charCodeAt(i % (left.length || 1)) || 0) ^ (right.charCodeAt(i % (right.length || 1)) || 0);
  return diff === 0;
}
function sheet() {
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!id) throw new Error("Set SPREADSHEET_ID in Script Properties");
  const spreadsheet = SpreadsheetApp.openById(id);
  const tabName = PropertiesService.getScriptProperties().getProperty("SHEET_NAME") || "Orders";
  let tab = spreadsheet.getSheetByName(tabName);
  if (!tab) tab = spreadsheet.insertSheet(tabName);
  if (tab.getLastRow() === 0) tab.appendRow(HEADERS);
  return tab;
}
function safeCell(value) {
  const text = value == null ? "" : String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
function createOrder(order) {
  if (!order || typeof order.id !== "string" || !/^\+212[5-7]\d{8}$/.test(String(order.phone)) ||
      typeof order.name !== "string" || order.name.length > 100 ||
      typeof order.address !== "string" || order.address.length > 200 ||
      typeof order.city !== "string" || order.city.length > 80 ||
      !Array.isArray(order.items) || !Number.isFinite(order.total) || order.total < 0) return output({ ok: false, message: "Invalid order" });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const tab = sheet();
    const itemsJson = JSON.stringify({ items: order.items, address: order.address });
    tab.appendRow([order.id, order.createdAt, order.status, order.name, order.phone, order.city, itemsJson, order.itemsSummary, order.total].map(safeCell));
  } finally {
    lock.releaseLock();
  }
  return output({ ok: true });
}
function listOrders() {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let tab;
  try {
    tab = sheet();
  } finally {
    lock.releaseLock();
  }
  const rows = tab.getDataRange().getValues();
  if (rows.length < 2) return output({ ok: true, orders: [] });
  const headers = rows[0].map(String);
  const orders = rows.slice(1).map((row) => {
    const item = {};
    headers.forEach((header, index) => { item[header] = row[index]; });
    try {
      const stored = JSON.parse(item.items || "[]");
      if (Array.isArray(stored)) item.items = stored;
      else { item.items = stored.items || []; item.address = stored.address || ""; }
    } catch (error) {
      console.error("Stored order item data could not be parsed", item.id);
      item.items = [];
    }
    return item;
  });
  return output({ ok: true, orders });
}
function updateOrder(id, status) {
  if (typeof id !== "string" || !STATUSES.includes(status)) return output({ ok: false, message: "Invalid order status" });
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const tab = sheet();
    if (tab.getLastRow() < 2) return output({ ok: false, message: "Order not found" });
    const rows = tab.getRange(2, 1, Math.max(tab.getLastRow() - 1, 0), 1).getValues();
    const index = rows.findIndex((row) => String(row[0]) === id);
    if (index < 0) return output({ ok: false, message: "Order not found" });
    tab.getRange(index + 2, 3).setValue(safeCell(status));
  } finally {
    lock.releaseLock();
  }
  return output({ ok: true });
}
