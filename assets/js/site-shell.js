(function () {
  "use strict";

  const pages = [
    ["home", "Home", "index.html"],
    ["owl-feed", "Owl Feed", "owl-feed.html"],
    ["credibility-scores", "Credibility", "credibility-scores.html"],
    ["tru-rankings", "T.R.U. Rankings", "tru-rankings.html"],
    ["voter-resources", "Voter Resources", "voter-resources.html"],
    ["media-influence-quiz", "Media Quiz", "media-influence-quiz.html"],
    ["fact-check-hub", "Fact Check", "fact-check-hub.html"],
    ["constitution", "Constitution", "constitution.html"],
    ["support", "Support", "support.html"]
  ];

  function pageLinks(activePage) {
    return pages.map(([id, label, href]) => {
      const current = id === activePage ? ' aria-current="page"' : "";
      return `<a href="${href}"${current}>${label}</a>`;
    }).join("");
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
            <a class="owl-brand" href="index.html" aria-label="The Strategic Owl home">
              <img src="assets/images/3X.png" alt="" />
              <span>The Strategic Owl</span>
            </a>
            <nav class="owl-primary-nav" id="owl-primary-nav" aria-label="Primary navigation" data-open="false">
              ${pageLinks(activePage)}
            </nav>
            <div class="owl-access-slot">
              <owl-access-button></owl-access-button>
            </div>
          </div>
          <button class="owl-menu-backdrop" type="button" tabindex="-1" aria-label="Close navigation" data-open="false"></button>
        </header>`;
    }

    if (footerHost) {
      footerHost.innerHTML = `<footer class="owl-site-footer">© 2026 The Strategic Owl.</footer>`;
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
      if (open) {
        const currentLink = menu.querySelector('[aria-current="page"]');
        (currentLink || menu.querySelector("a"))?.focus();
      }
    }

    menuButton?.addEventListener("click", () => {
      setMenu(menu?.dataset.open !== "true");
    });
    backdrop?.addEventListener("click", () => setMenu(false));
    menu?.addEventListener("click", (event) => {
      if (event.target.closest("a")) setMenu(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu?.dataset.open === "true") {
        setMenu(false);
        menuButton?.focus();
      }
    });
    window.addEventListener("resize", () => {
      if (window.innerWidth > 1240 && menu?.dataset.open === "true") setMenu(false);
    });
  }

  renderShell();
})();
