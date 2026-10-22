const productFallback = "assets/product.svg";
const params = new URLSearchParams(location.search);
const productId = params.get("id");

async function loadProduct() {
  const [response, configResponse, categoriesResponse] = await Promise.all([fetch("data/products.json"), fetch("data/config.json"), fetch("data/categories.json")]);
  if (!response.ok || !configResponse.ok || !categoriesResponse.ok) throw new Error("تعذر تحميل المنتج.");
  const [products, config, categories] = await Promise.all([response.json(), configResponse.json(), categoriesResponse.json()]);
  const product = products.find((item) => item.id === productId && item.status === "active");
  const root = document.getElementById("product-detail");
  if (!product) { root.textContent = "ما لقيناش هاد المنتج."; return; }
  document.title = `${product.name} | ${config.storeName || "المتجر"}`;
  const brand = document.querySelector(".brand");
  if (brand) brand.textContent = config.storeName || "المتجر";
  document.documentElement.style.setProperty("--brand", /^#[\da-f]{6}$/i.test(config.primaryColor) ? config.primaryColor : "#17624f");
  document.documentElement.style.setProperty("--accent", /^#[\da-f]{6}$/i.test(config.secondaryColor) ? config.secondaryColor : "#d59b52");
  document.documentElement.style.setProperty("--store-font", ["system-ui", "Arial", "Georgia", "Tahoma"].includes(config.font) ? config.font : "system-ui");
  root.replaceChildren();
  const layout = document.createElement("div");
  layout.className = "detail-layout";
  const gallery = document.createElement("div");
  const image = document.createElement("img");
  image.className = "detail-image";
  image.src = product.images?.[0] || productFallback;
  image.alt = product.name;
  image.width = 640;
  image.height = 480;
  image.addEventListener("error", () => { image.src = productFallback; }, { once: true });
  gallery.append(image);
  const images = [...new Set(product.images || [])];
  if (images.length > 1) {
    const thumbnails = document.createElement("div"); thumbnails.className = "filters";
    images.forEach((url, index) => {
      const thumbnail = document.createElement("button"); thumbnail.type = "button"; thumbnail.className = "filter-chip"; thumbnail.textContent = `الصورة ${index + 1}`;
      thumbnail.setAttribute("aria-label", `عرض الصورة ${index + 1}`);
      thumbnail.addEventListener("click", () => { image.src = url; });
      thumbnails.append(thumbnail);
    });
    gallery.append(thumbnails);
  }
  const content = document.createElement("section");
  content.className = "detail-controls";
  const title = document.createElement("h1"); title.textContent = product.name;
  const category = categories.find((item) => item.id === product.category);
  const categoryLabel = document.createElement("p"); categoryLabel.textContent = category?.name || "";
  const badge = document.createElement("p"); badge.textContent = product.badge || "";
  const price = document.createElement("p"); price.className = "price"; price.textContent = `${product.price} درهم`;
  const description = document.createElement("p"); description.textContent = product.description;
  const stock = document.createElement("p"); stock.textContent = product.stock > 0 ? `متوفر (${product.stock})` : "غير متوفر";
  content.append(categoryLabel, badge, title, price, description, stock);
  const selectors = {};
  [["size", "المقاس", product.sizes], ["color", "اللون", product.colors]].forEach(([key, labelText, values]) => {
    if (!values?.length) return;
    const label = document.createElement("label"); label.textContent = labelText;
    const select = document.createElement("select"); select.required = true;
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = `اختار ${labelText}`; select.append(placeholder);
    values.forEach((value) => { const option = document.createElement("option"); option.value = value; option.textContent = value; select.append(option); });
    label.append(select); content.append(label); selectors[key] = select;
  });
  const actions = document.createElement("div"); actions.className = "detail-actions";
  const add = document.createElement("button"); add.type = "button"; add.className = "button"; add.textContent = "أضف إلى السلة";
  const orderNow = document.createElement("button"); orderNow.type = "button"; orderNow.className = "button button-light"; orderNow.textContent = "اطلب الآن";
  add.disabled = product.stock <= 0;
  orderNow.disabled = product.stock <= 0;
  const addLine = (checkout) => {
    if (Object.values(selectors).some((select) => !select.value)) { document.getElementById("product-message").textContent = "اختار المقاس واللون قبل ما تزيد المنتج للسلة."; return; }
    try {
      const stored = JSON.parse(localStorage.getItem("mouga-cart-v1") || "[]");
      if (!Array.isArray(stored)) throw new Error("invalid");
      const size = selectors.size?.value || "";
      const color = selectors.color?.value || "";
      const existing = stored.find((line) => line.id === product.id && line.size === size && line.color === color);
      if (existing) existing.quantity = Math.min(product.stock, existing.quantity + 1);
      else stored.push({ id: product.id, quantity: 1, size, color });
      localStorage.setItem("mouga-cart-v1", JSON.stringify(stored));
      if (checkout) location.href = "index.html?openCart=1";
      else document.getElementById("product-message").textContent = "تزاد المنتج للسلة.";
    } catch {
      localStorage.removeItem("mouga-cart-v1");
      document.getElementById("product-message").textContent = "السلة المحفوظة فيها مشكل. عاود زيد المنتج.";
    }
  };
  add.addEventListener("click", () => addLine(false));
  orderNow.addEventListener("click", () => addLine(true));
  actions.append(add, orderNow);
  content.append(actions);
  layout.append(gallery, content);
  root.append(layout);
  const recommended = products.filter((item) => item.id !== product.id && item.status === "active" && item.stock > 0 && item.category === product.category).slice(0, 4);
  if (recommended.length) {
    const heading = document.createElement("h2"); heading.textContent = "منتجات ممكن تعجبك";
    const grid = document.createElement("div"); grid.className = "product-grid";
    recommended.forEach((item) => {
      const link = document.createElement("a"); link.className = "product-card"; link.href = `product.html?id=${encodeURIComponent(item.id)}`; link.textContent = `${item.name} — ${item.price} درهم`;
      grid.append(link);
    });
    root.append(heading, grid);
  }
}

loadProduct().catch((error) => { document.getElementById("product-message").textContent = error.message || "تعذر تحميل المنتج."; });
