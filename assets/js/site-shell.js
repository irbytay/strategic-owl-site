(function () {
  "use strict";

  const pages = [
    ["home", "Home", "index.html", "M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z"],
    ["coverage", "Owl Radar", "coverage.html", "M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1M12 3v3m0 12v3M5.6 18.4l2.1-2.1m8.6-8.6 2.1-2.1M9 12a3 3 0 1 1 6 0 3 3 0 0 1-6 0Z"],
    ["civic-owl", "Civic Owl", "civic-owl.html", "M12 3.2 14.4 7l4.4.3-2.7 3.5 1.1 4.3-3.2-2.3-3.8 2.3 1.1-4.3-2.7-3.5 4.4-.3zM9.6 15.4 12 13.9l2.4 1.5-.7 2.7H10.3z"],
    ["constitution", "Library", "constitution.html", "M5 5.5A2.5 2.5 0 0 1 7.5 3H11v16H7.5A2.5 2.5 0 0 0 5 21.5Zm8-2.5h3.5A2.5 2.5 0 0 1 19 5.5v16a2.5 2.5 0 0 0-2.5-2.5H13Z"]
  ];

  const spaPaths = new Set(pages.map(([, , href]) => `/${href}`));
  const viewCache = new Map();
  const loadedScripts = new Set(
    [...document.scripts].map((script) => script.src).filter(Boolean)
  );
  let navigationInProgress = false;
  let activeRouteKey = routePath(new URL(window.location.href));

  function routePath(url) {
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    return path.replace(/\/+/g, "/");
  }

  function isSpaRoute(url) {
    return url.origin === window.location.origin && spaPaths.has(routePath(url));
  }

  function currentRouteKey() {
    return activeRouteKey;
  }

  function pageIdFromDocument(documentValue) {
    return documentValue.body?.dataset?.page || "home";
  }

  function updateCurrentNavigation(page) {
    const normalized = normalizedPage(page);
    document.querySelectorAll(".owl-primary-nav a, .owl-mobile-nav a").forEach((link) => {
      const linkUrl = new URL(link.href, window.location.href);
      const match = pages.find(([, , href]) => routePath(linkUrl) === `/${href}`);
      if (match?.[0] === normalized) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function installPageStyles(parsedDocument) {
    parsedDocument.querySelectorAll('link[rel="stylesheet"][href*="assets/css/pages/"]').forEach((source) => {
      const absoluteHref = new URL(source.getAttribute("href"), window.location.href).href;
      if (document.querySelector(`link[rel="stylesheet"][href="${absoluteHref}"]`)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = absoluteHref;
      link.dataset.owlSpaStyle = "true";
      document.head.appendChild(link);
    });
  }

  async function installPageScripts(parsedDocument) {
    const scripts = [...parsedDocument.querySelectorAll("script[src]")]
      .map((script) => new URL(script.getAttribute("src"), window.location.href).href)
      .filter((src) => src.includes("/assets/js/") &&
        !src.includes("/site-shell.js") &&
        !src.includes("/owl-access.js"));

    for (const src of scripts) {
      if (loadedScripts.has(src)) continue;
      await new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = src;
        script.onload = () => { loadedScripts.add(src); resolve(); };
        script.onerror = () => reject(new Error(`Unable to load ${src}`));
        document.body.appendChild(script);
      });
    }
  }

  function applyDocumentDetails(parsedDocument) {
    const page = pageIdFromDocument(parsedDocument);
    document.body.className = parsedDocument.body.className || "site-body";
    document.body.dataset.page = page;
    document.title = parsedDocument.title || "The Strategic Owl";
    const nextDescription = parsedDocument.querySelector('meta[name="description"]')?.content;
    const description = document.querySelector('meta[name="description"]');
    if (description && nextDescription) description.content = nextDescription;
    updateCurrentNavigation(page);
  }

  async function navigateWithinSite(destination, { replace = false, fromHistory = false } = {}) {
    const url = new URL(destination, window.location.href);
    if (!isSpaRoute(url) || navigationInProgress) return false;
    const nextKey = routePath(url);
    const currentMain = document.getElementById("main-content");
    if (!currentMain) return false;

    if (nextKey === currentRouteKey()) {
      if (!fromHistory) window.history[replace ? "replaceState" : "pushState"]({}, "", url);
      currentMain.focus({ preventScroll: true });
      return true;
    }

    navigationInProgress = true;
    document.body.classList.add("owl-view-loading");
    try {
      viewCache.set(currentRouteKey(), {
        main: currentMain,
        bodyClass: document.body.className.replace(/\s*owl-view-loading\b/g, ""),
        page: document.body.dataset.page || "home",
        title: document.title,
        description: document.querySelector('meta[name="description"]')?.content || ""
      });

      let nextView = viewCache.get(nextKey);
      if (!nextView) {
        const response = await fetch(url.href, { headers: { "X-Strategic-Owl-View": "1" } });
        if (!response.ok) throw new Error(`View returned ${response.status}`);
        const parsed = new DOMParser().parseFromString(await response.text(), "text/html");
        const parsedMain = parsed.getElementById("main-content");
        if (!parsedMain) throw new Error("The requested view is unavailable.");
        installPageStyles(parsed);
        nextView = {
          main: document.importNode(parsedMain, true),
          bodyClass: parsed.body.className || "site-body",
          page: pageIdFromDocument(parsed),
          title: parsed.title || "The Strategic Owl",
          description: parsed.querySelector('meta[name="description"]')?.content || "",
          parsed
        };
        viewCache.set(nextKey, nextView);
      }

      currentMain.replaceWith(nextView.main);
      document.body.className = nextView.bodyClass;
      document.body.dataset.page = nextView.page;
      document.title = nextView.title;
      const description = document.querySelector('meta[name="description"]');
      if (description && nextView.description) description.content = nextView.description;
      updateCurrentNavigation(nextView.page);
      if (nextView.parsed) {
        await installPageScripts(nextView.parsed);
        delete nextView.parsed;
      }
      if (!fromHistory) window.history[replace ? "replaceState" : "pushState"]({}, "", url);
      activeRouteKey = nextKey;
      window.scrollTo({ top: 0, behavior: "auto" });
      nextView.main.classList.add("owl-view-entering");
      window.setTimeout(() => nextView.main.classList.remove("owl-view-entering"), 220);
      nextView.main.focus({ preventScroll: true });
      window.dispatchEvent(new CustomEvent("strategic-owl-view-change", { detail: { page: nextView.page } }));
      return true;
    } catch (error) {
      console.warn("In-place navigation was unavailable; using a standard page load.", error);
      window.location.assign(url.href);
      return false;
    } finally {
      navigationInProgress = false;
      document.body.classList.remove("owl-view-loading");
    }
  }

  function installSpaNavigation() {
    viewCache.set(currentRouteKey(), {
      main: document.getElementById("main-content"),
      bodyClass: document.body.className,
      page: document.body.dataset.page || "home",
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || ""
    });

    document.addEventListener("click", (event) => {
      const link = event.target.closest(".owl-brand, .owl-primary-nav a, .owl-mobile-nav a");
      if (!link || event.defaultPrevented || event.button !== 0 ||
          event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ||
          link.target || link.hasAttribute("download")) return;
      const url = new URL(link.href, window.location.href);
      if (!isSpaRoute(url)) return;
      event.preventDefault();
      navigateWithinSite(url);
    });

    window.addEventListener("popstate", () => {
      const url = new URL(window.location.href);
      if (isSpaRoute(url)) navigateWithinSite(url, { fromHistory: true });
    });
  }

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
      ["Projects & Links", "projects.html"],
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
            <a class="owl-brand" href="index.html" aria-label="The Strategic Owl home"><img src="assets/images/3X.png" alt="" /><span>The Strategic Owl</span></a>
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
            <div><strong>The Strategic Owl</strong><span>News, civic learning, and the founding library.</span></div>
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
  installSpaNavigation();
})();
