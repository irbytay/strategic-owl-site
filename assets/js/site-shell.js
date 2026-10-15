(function () {
  "use strict";

  const pages = [
    ["home", "Home", "index.html", "M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"],
    ["coverage", "Coverage", "coverage.html", "M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M12 3v3m0 12v3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z"],
    ["voter-resources", "Voter Resources", "voter-resources.html", "M12 3 5 6v5c0 4.8 2.9 8.1 7 10 4.1-1.9 7-5.2 7-10V6zM9 12l2 2 4-5"],
    ["constitution", "Constitution", "constitution.html", "M7 4h10a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 4h6M9 12h6M9 16h4"]
  ];

  function normalizedPage(page) {
    return page === "news-feed" || page === "news-sources" ? "coverage" : page;
  }

  function pageLinks(activePage, mobile = false) {
    return pages.map(([id, label, href, path]) => {
      const current = id === normalizedPage(activePage) ? ' aria-current="page"' : "";
      const icon = mobile
        ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`
        : "";
      return `<a href="${href}"${current}>${icon}<span>${label}</span></a>`;
    }).join("");
  }

  function secondaryLinks() {
    return [
      ["Support", "support.html"],
      ["Privacy", "privacy.html"],
      ["iPhone App", "https://apps.apple.com/app/the-strategic-owl/id6748349497"],
      ["Owl Store", "https://thestrategicowl.printful.me"]
    ].map(([label, href]) => `<a href="${href}">${label}</a>`).join("");
  }

  function updateAdministratorNavigation() {
    const administrator = Boolean(window.StrategicOwlAccess?.isAdministrator());
    document.querySelectorAll('[data-administrator-only="true"]').forEach((link) => {
      link.hidden = !administrator;
    });
  }

  function installKeyboardDismissal() {
    const editableSelector = "input, textarea, select, [contenteditable='true']";
    document.addEventListener("pointerdown", (event) => {
      const active = document.activeElement;
      if (active?.matches?.(editableSelector) && !event.target.closest?.(editableSelector)) active.blur();
    }, true);
  }

  function renderShell() {
    const headerHost = document.getElementById("site-header");
    const footerHost = document.getElementById("site-footer");
    const activePage = document.body.dataset.page || "home";

    if (headerHost) {
      headerHost.innerHTML = `
        <header class="owl-site-header">
          <div class="owl-header-inner">
            <button class="owl-menu-button" type="button" aria-label="Open navigation" aria-controls="owl-primary-nav" aria-expanded="false">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>
            </button>
            <a class="owl-brand" href="index.html" aria-label="The Strategic Owl home"><span>The Strategic Owl</span></a>
            <nav class="owl-primary-nav" id="owl-primary-nav" aria-label="Primary navigation" data-open="false">
              ${pageLinks(activePage)}
              <a href="owl-office.html" data-administrator-only="true" hidden>Publisher Desk</a>
            </nav>
            <div class="owl-access-slot"><owl-access-button></owl-access-button></div>
          </div>
          <button class="owl-menu-backdrop" type="button" tabindex="-1" aria-label="Close navigation" data-open="false"></button>
        </header>
        <nav class="owl-mobile-nav" aria-label="Primary mobile navigation">${pageLinks(activePage, true)}</nav>`;
    }

    if (footerHost) {
      footerHost.innerHTML = `
        <footer class="owl-site-footer">
          <div class="owl-footer-brand">
            <img src="assets/images/3X.png" alt="" />
            <div><strong>The Strategic Owl</strong><span>Truth. Reliability. Understanding.</span></div>
          </div>
          <nav aria-label="Secondary navigation">${secondaryLinks()}</nav>
          <p>© 2026 The Strategic Owl.</p>
        </footer>`;
    }

    const menuButton = document.querySelector(".owl-menu-button");
    const menu = document.getElementById("owl-primary-nav");
    const backdrop = document.querySelector(".owl-menu-backdrop");

    function setMenu(open) {
      if (!menuButton || !menu || !backdrop) return;
      menu.dataset.open = String(open);
      backdrop.dataset.open = String(open);
      menuButton.setAttribute("aria-expanded", String(open));
      menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
      document.body.classList.toggle("owl-menu-open", open);
      if (open) (menu.querySelector('[aria-current="page"]') || menu.querySelector("a"))?.focus();
    }

    menuButton?.addEventListener("click", () => setMenu(menu?.dataset.open !== "true"));
    backdrop?.addEventListener("click", () => setMenu(false));
    menu?.addEventListener("click", (event) => { if (event.target.closest("a")) setMenu(false); });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu?.dataset.open === "true") {
        setMenu(false);
        menuButton?.focus();
      }
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 1240 && menu?.dataset.open === "true") setMenu(false);
    });

    updateAdministratorNavigation();
    window.addEventListener("strategic-owl-access-change", updateAdministratorNavigation);
  }

  renderShell();
  installKeyboardDismissal();
})();
