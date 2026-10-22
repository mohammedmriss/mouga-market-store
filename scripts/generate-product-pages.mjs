import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const products = JSON.parse(await readFile(resolve(root, "data/products.json"), "utf8"));
const config = JSON.parse(await readFile(resolve(root, "data/config.json"), "utf8"));
const storeName = config.storeName || "المتجر";
const origin = (process.env.SITE_URL || "https://YOUR-DOMAIN.example").replace(/\/$/, "");
const escape = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const visible = products.filter((product) => product.status === "active");
await mkdir(resolve(root, "products"), { recursive: true });
for (const product of visible) {
  if (!/^[a-z0-9-]{1,80}$/.test(product.id)) throw new Error(`Invalid product id: ${product.id}`);
  const canonical = `${origin}/products/${encodeURIComponent(product.id)}.html`;
  const image = product.images?.[0] || "assets/product.svg";
  const absoluteImage = new URL(image, `${origin}/`).href;
  const description = product.description.slice(0, 250);
  const schema = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description,
    image: absoluteImage,
    offers: { "@type": "Offer", priceCurrency: "MAD", price: String(product.price), availability: product.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url: canonical }
  };
  const html = `<!doctype html>
<html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none"><meta name="description" content="${escape(description)}"><meta property="og:title" content="${escape(product.name)} | ${escape(storeName)}"><meta property="og:description" content="${escape(description)}"><meta property="og:image" content="${escape(absoluteImage)}"><meta property="og:url" content="${escape(canonical)}"><link rel="canonical" href="${escape(canonical)}"><title>${escape(product.name)} | ${escape(storeName)}</title><link rel="stylesheet" href="../css/style.css"><script type="application/ld+json">${JSON.stringify(schema).replace(/</g, "\\u003c")}</script></head><body><header class="site-header"><a class="brand" href="../index.html">${escape(storeName)}</a></header><main class="section narrow"><img class="detail-image" src="${escape(absoluteImage)}" alt="${escape(product.name)}" width="640" height="480"><h1>${escape(product.name)}</h1><p>${escape(description)}</p><p class="price">${escape(product.price)} درهم</p><p><a class="button" href="../product.html?id=${encodeURIComponent(product.id)}">اطلب الآن</a></p></main><footer class="site-footer"><a href="../index.html">الصفحة الرئيسية</a><a href="../contact.html">تواصل معنا</a></footer></body></html>
`;
  await writeFile(resolve(root, "products", `${product.id}.html`), html, "utf8");
}
const staticPaths = ["", "contact.html", "privacy-policy.html", "terms.html", ...visible.map((product) => `products/${product.id}.html`)];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${staticPaths.map((path) => `  <url><loc>${escape(`${origin}/${path}`)}</loc></url>`).join("\n")}\n</urlset>\n`;
await writeFile(resolve(root, "sitemap.xml"), sitemap, "utf8");
console.log(`Generated ${visible.length} product pages and sitemap for ${origin}`);
