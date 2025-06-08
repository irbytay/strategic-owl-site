// ✅ FUNCTION: Load HTML content into the SPA container
function loadPageContent(path) {
  fetch(path)
    .then(res => res.text())
    .then(html => {
      // 🟦 Inject HTML into the main content area
      document.getElementById('spa-content').innerHTML = html;
      window.scrollTo(0, 0);

      // ✅ LOAD CORRESPONDING JS FILE (if exists)
      // 🟨 Build path to JS file: assumes matching name in scripts/ folder
      const scriptPath = "scripts/" + path.replace('.html', '.js');

      // 🟥 Remove old script tag if it exists (prevents duplicates)
      const oldScript = document.getElementById('dynamic-script');
      if (oldScript) oldScript.remove();

      // 🟩 Create new script element and append to body
      const newScript = document.createElement('script');
      newScript.src = scriptPath;
      newScript.id = 'dynamic-script';
      document.body.appendChild(newScript);
    })
    .catch(err => {
      // 🔴 Error fallback
      document.getElementById('spa-content').innerHTML = "<p>Sorry, something went wrong loading this page.</p>";
      console.error("SPA Load Error:", err);
    });
}

// ✅ ON PAGE LOAD: Set up navigation and legal popup logic
document.addEventListener('DOMContentLoaded', () => {
  // 🟦 Load default homepage content
  loadPageContent('TRUOWL2_v3.html');

  // ✅ HANDLE NAVIGATION LINKS (SPA-style)
  // 🟨 Attach click handlers to all links with data-path
  document.querySelectorAll('a[data-path]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const path = link.getAttribute('data-path');
      if (path) loadPageContent(path);
    });
  });

  // ✅ LEGAL POPUP LOGIC
  // 🟦 Set up legal modal to appear every 30 days if not accepted
  const legalPopup = document.getElementById('legal-popup');
  const lastAccepted = localStorage.getItem('legalPopupAccepted');
  const now = Date.now();
  const thirtyDays = 1000 * 60 * 60 * 24 * 30;

  if (legalPopup && (!lastAccepted || now - parseInt(lastAccepted) > thirtyDays)) {
    legalPopup.style.display = 'block';
  }

  // 🟩 Accept button closes the popup and sets localStorage
  const acceptBtn = document.getElementById('accept-link');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      localStorage.setItem('legalPopupAccepted', Date.now().toString());
      if (legalPopup) legalPopup.style.display = 'none';
    });
  }
});
