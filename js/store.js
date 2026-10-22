const fallbackProductImage = "assets/product.svg";
const configUrl = "data/config.json";
const productsUrl = "data/products.json";
const categoriesUrl = "data/categories.json";
const cartKey = "mouga-cart-v1";
let products = [];
let categories = [];
let activeCategory = "all";
let cart = readCart();

function readCart() {
  try {
    const value = JSON.parse(localStorage.getItem(cartKey) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter((line) => line && typeof line.id === "string" && Number.isInteger(line.quantity) && line.quantity > 0);
  } catch (error) {
    console.warn("تعذر قراءة السلة المحفوظة", error);
    return [];
  }
}

function saveCart() {
  localStorage.setItem(cartKey, JSON.stringify(cart));
  updateCart();
}

function addToCart(product, options = {}) {
  if (product.stock < 1) return;
  if ((product.sizes?.length && !options.size) || (product.colors?.length && !options.color)) {
    window.location.href = `product.html?id=${encodeURIComponent(product.id)}`;
    return;
  }
  const existing = cart.find((line) => line.id === product.id && line.size === (options.size || "") && line.color === (options.color || ""));
  if (existing) existing.quantity = Math.min(product.stock, existing.quantity + 1);
  else cart.push({ id: product.id, quantity: 1, size: options.size || "", color: options.color || "" });
  saveCart();
}

function updateCart() {
  const count = cart.reduce((total, line) => total + line.quantity, 0);
  const countElement = document.getElementById("cart-count");
  if (countElement) countElement.textContent = String(count);
  renderCart();
}

function renderCart() {
  const list = document.getElementById("cart-items");
  const totalElement = document.getElementById("cart-total");
  if (!list || !totalElement) return;
  list.replaceChildren();
  let total = 0;
  cart.forEach((line, index) => {
    const product = products.find((item) => item.id === line.id);
    if (!product) return;
    total += product.price * line.quantity;
    const row = document.createElement("div");
    row.className = "cart-line";
    const info = document.createElement("div");
    info.className = "cart-line-info";
    const title = document.createElement("strong");
    title.textContent = product.name;
    const meta = document.createElement("p");
    meta.textContent = [line.size, line.color].filter(Boolean).join(" · ");
    const price = document.createElement("p");
    price.textContent = `${product.price} درهم`;
    info.append(title, meta, price);
    const controls = document.createElement("div");
    controls.className = "cart-line-actions";
    const decrement = document.createElement("button");
    decrement.type = "button";
    decrement.textContent = "−";
    decrement.setAttribute("aria-label", `نقص الكمية: ${product.name}`);
    decrement.addEventListener("click", () => changeQuantity(index, -1));
    const quantity = document.createElement("span");
    quantity.textContent = String(line.quantity);
    const increment = document.createElement("button");
    increment.type = "button";
    increment.textContent = "+";
    increment.setAttribute("aria-label", `زيد الكمية: ${product.name}`);
    increment.addEventListener("click", () => changeQuantity(index, 1));
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "حيد";
    remove.addEventListener("click", () => { cart.splice(index, 1); saveCart(); });
    controls.append(decrement, quantity, increment, remove);
    row.append(info, controls);
    list.append(row);
  });
  totalElement.textContent = `${total} درهم`;
}

function changeQuantity(index, delta) {
  const line = cart[index];
  const product = products.find((item) => item.id === line?.id);
  if (!product) return;
  line.quantity += delta;
  if (line.quantity < 1) cart.splice(index, 1);
  else line.quantity = Math.min(line.quantity, product.stock);
  saveCart();
}

function renderProducts() {
  const grid = document.getElementById("product-grid");
  const message = document.getElementById("store-message");
  if (!grid) return;
  grid.replaceChildren();
  const visible = products.filter((product) => product.status === "active" && product.stock > 0 && (activeCategory === "all" || product.category === activeCategory));
  if (!visible.length && message) message.textContent = "ما كايناش منتجات فهاد الفئة دابا.";
  else if (message) message.textContent = "";
  visible.forEach((product) => {
    const card = document.createElement("article");
    card.className = "product-card";
    const image = document.createElement("img");
    image.src = product.images?.[0] || fallbackProductImage;
    image.alt = product.name;
    image.width = 420;
    image.height = 300;
    image.loading = "lazy";
    image.addEventListener("error", () => { image.src = fallbackProductImage; }, { once: true });
    const body = document.createElement("div");
    body.className = "product-card-body";
    const heading = document.createElement("h3");
    heading.textContent = product.name;
    const description = document.createElement("p");
    description.textContent = product.description;
    const price = document.createElement("p");
    price.className = "price";
    price.textContent = `${product.price} درهم`;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button";
    button.textContent = product.sizes?.length || product.colors?.length ? "اختار المقاس أو اللون" : "أضف إلى السلة";
    button.addEventListener("click", () => addToCart(product));
    body.append(heading, description, price, button);
    card.append(image, body);
    grid.append(card);
  });
}

function renderCategories() {
  const filters = document.getElementById("category-filters");
  if (!filters) return;
  filters.replaceChildren();
  categories.forEach((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "filter-chip";
    button.textContent = category.name;
    button.setAttribute("aria-pressed", String(activeCategory === category.id));
    button.addEventListener("click", () => { activeCategory = category.id; renderCategories(); renderProducts(); });
    filters.append(button);
  });
}

async function loadData() {
  const responses = await Promise.all([fetch(configUrl), fetch(productsUrl), fetch(categoriesUrl)]);
  if (responses.some((response) => !response.ok)) throw new Error("تعذر تحميل بيانات المتجر");
  const [config, productData, categoryData] = await Promise.all(responses.map((response) => response.json()));
  products = productData;
  categories = categoryData;
  const announcement = document.getElementById("announcement");
  if (announcement) {
    announcement.textContent = config.announcement?.enabled ? config.announcement.text : "";
    announcement.hidden = !config.announcement?.enabled;
  }
  const safeFonts = ["system-ui", "Arial", "Georgia", "Tahoma"];
  document.documentElement.style.setProperty("--store-font", safeFonts.includes(config.font) ? config.font : "system-ui");
  document.title = `${config.storeName || "Mouga Market"} | تسوق بثقة`;
  document.documentElement.style.setProperty("--brand", /^#[\da-f]{6}$/i.test(config.primaryColor) ? config.primaryColor : "#17624f");
  document.documentElement.style.setProperty("--accent", /^#[\da-f]{6}$/i.test(config.secondaryColor) ? config.secondaryColor : "#d59b52");
  const brand = document.getElementById("brand");
  if (brand) {
    brand.replaceChildren();
    if (config.logoUrl && /^https?:\/\//i.test(config.logoUrl)) {
      const logo = document.createElement("img");
      logo.src = config.logoUrl;
      logo.alt = config.storeName || "Mouga Market";
      logo.width = 150;
      logo.height = 48;
      logo.addEventListener("error", () => { brand.textContent = config.storeName || "Mouga Market"; }, { once: true });
      brand.append(logo);
    } else brand.textContent = config.storeName || "Mouga Market";
  }
  const footer = document.getElementById("footer-text");
  if (footer) footer.textContent = config.footerText || config.storeName || "Mouga Market";
  document.querySelector(".benefits").hidden = config.sections?.benefits === false;
  document.querySelector(".about").hidden = config.sections?.about === false;
  document.querySelector(".contact-callout").hidden = config.sections?.contact === false;
  const heroSlides = (config.slides || []).filter((slide) => slide.enabled !== false);
  if (heroSlides.length) {
    const title = document.getElementById("hero-title");
    const description = document.getElementById("hero-description");
    const button = document.getElementById("hero-button");
    const image = document.querySelector("#hero img");
    let slideIndex = 0;
    const renderSlide = () => {
      const slide = heroSlides[slideIndex];
      title.textContent = slide.title;
      description.textContent = slide.description || "";
      button.textContent = slide.buttonText || "تسوق دابا";
      const link = slide.buttonLink || "#products";
      button.href = /^(#|\/(?!\/)|[a-zA-Z0-9])[a-zA-Z0-9_./?=&%-]*$/.test(link) || /^https?:\/\//i.test(link) ? link : "#products";
      image.src = /^https?:\/\//i.test(slide.image || "") ? slide.image : fallbackProductImage;
      if (/^https?:\/\//i.test(link)) { button.target = "_blank"; button.rel = "noopener noreferrer"; }
      else { button.removeAttribute("target"); button.removeAttribute("rel"); }
    };
    renderSlide();
    if (heroSlides.length > 1) {
      const controls = document.createElement("div");
      controls.className = "detail-actions";
      [["السابق", -1], ["التالي", 1]].forEach(([label, direction]) => {
        const control = document.createElement("button");
        control.type = "button"; control.className = "button button-light"; control.textContent = label;
        control.addEventListener("click", () => { slideIndex = (slideIndex + direction + heroSlides.length) % heroSlides.length; renderSlide(); });
        controls.append(control);
      });
      document.querySelector("#hero > div").append(controls);
    }
  }
  document.getElementById("year").textContent = String(new Date().getFullYear());
  renderCategories();
  renderProducts();
  updateCart();
  window.storeConfig = config;
}

document.getElementById("cart-open")?.addEventListener("click", () => document.getElementById("cart-dialog").showModal());
document.querySelector("[data-close]")?.addEventListener("click", () => document.getElementById("cart-dialog").close());
if (new URLSearchParams(location.search).has("openCart")) {
  document.addEventListener("DOMContentLoaded", () => document.getElementById("cart-dialog")?.showModal(), { once: true });
}
document.getElementById("checkout-form")?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const message = document.getElementById("checkout-message");
  const button = document.getElementById("checkout-button");
  const endpoint = window.storeConfig?.order_endpoint;
  if (!endpoint) { message.textContent = "خدمة الطلبات مازال ما تجهزاتش. عيط لينا باش نعاونوك."; return; }
  if (!cart.length) { message.textContent = "السلة خاوية."; return; }
  button.disabled = true;
  message.textContent = "كنصيفطو الطلب ديالك…";
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"), phone: normalizeMoroccanPhone(data.get("phone")),
        city: data.get("city"), address: data.get("address"), website: data.get("website"),
        items: cart.map((line) => ({ id: line.id, quantity: line.quantity, size: line.size, color: line.color }))
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || "ما قدرناش نصيفطو الطلب، عاود المحاولة.");
    cart = [];
    saveCart();
    form.reset();
    message.textContent = "وصلنا الطلب ديالك، غادي نتاصلو بيك باش نأكدو التفاصيل.";
  } catch (error) {
    message.textContent = error.message || "وقع مشكل فالاتصال. عاود المحاولة من بعد.";
  } finally {
    button.disabled = false;
  }
});

function normalizeMoroccanPhone(value) {
  const digits = String(value || "").replace(/[\s-]/g, "");
  if (/^0[567]\d{8}$/.test(digits)) return `+212${digits.slice(1)}`;
  if (/^\+212[567]\d{8}$/.test(digits)) return digits;
  throw new Error("دخل رقم مغربي صحيح (06 أو 07 أو +212).");
}

loadData().catch((error) => {
  document.getElementById("store-message").textContent = error.message || "تعذر تحميل المتجر. عاود تحديث الصفحة.";
});
