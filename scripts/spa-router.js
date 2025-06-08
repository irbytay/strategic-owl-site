function loadPageContent(path) {
  fetch(path)
    .then(res => res.text())
    .then(html => {
      document.getElementById('spa-content').innerHTML = html;
      window.scrollTo(0, 0);
    })
    .catch(err => {
      document.getElementById('spa-content').innerHTML = "<p>Sorry, something went wrong loading this page.</p>";
      console.error("SPA Load Error:", err);
    });
}

document.addEventListener('DOMContentLoaded', () => {
  // Load home page content by default
  loadPageContent('TRUOWL2_v3.html');

  // SPA navigation handling
  document.querySelectorAll('a[data-path]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const path = link.getAttribute('data-path');
      if (path) loadPageContent(path);
    });
  });

  // Legal popup check (every 30 days)
  const legalPopup = document.getElementById('legal-popup');
  const lastAccepted = localStorage.getItem('legalPopupAccepted');
  const now = Date.now();
  const thirtyDays = 1000 * 60 * 60 * 24 * 30;

  if (legalPopup && (!lastAccepted || now - parseInt(lastAccepted) > thirtyDays)) {
    legalPopup.style.display = 'block';
  }

  // Legal popup acceptance
  const acceptBtn = document.getElementById('accept-link');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      localStorage.setItem('legalPopupAccepted', Date.now().toString());
      if (legalPopup) legalPopup.style.display = 'none';
    });
  }
});
