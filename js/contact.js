async function showContactDetails() {
  const container = document.getElementById("contact-details");
  try {
    const response = await fetch("data/config.json");
    if (!response.ok) throw new Error("تعذر تحميل معلومات التواصل.");
    const config = await response.json();
    container.replaceChildren();
    let hasContact = false;
    if (config.phone && /^[+0-9 ()-]{5,30}$/.test(config.phone)) {
      const phone = document.createElement("p");
      const link = document.createElement("a");
      link.href = `tel:${config.phone.replace(/[^\d+]/g, "")}`;
      link.textContent = config.phone;
      phone.append("الهاتف: ", link);
      container.append(phone);
      hasContact = true;
    }
    if (config.whatsapp && /^\+?\d{8,15}$/.test(config.whatsapp.replace(/[\s-]/g, ""))) {
      const number = config.whatsapp.replace(/\D/g, "");
      const link = document.createElement("a");
      link.href = `https://wa.me/${number}`;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "تواصل معنا على واتساب";
      container.append(link);
      hasContact = true;
    }
    if (config.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(config.email)) {
      const link = document.createElement("a");
      link.href = `mailto:${config.email}`;
      link.textContent = config.email;
      container.append(link);
      hasContact = true;
    }
    if (!hasContact) container.textContent = "معلومات التواصل ديال المتجر غادي تزيد قريبا.";
    document.title = `تواصل معنا | ${config.storeName || "المتجر"}`;
    const brand = document.querySelector(".brand");
    if (brand) brand.textContent = config.storeName || "المتجر";
  } catch (error) {
    container.textContent = error.message || "وقع مشكل فالتحميل، عاود من بعد.";
  }
}
showContactDetails();
