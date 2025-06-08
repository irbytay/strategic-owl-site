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
  // Load home page by default
  loadPageContent('home.html');

  // Handle nav link clicks
  document.querySelectorAll('a[data-path]').forEach(link => {
    link.addEventListener('click', e => {
      e.preventDefault();
      const path = link.getAttribute('data-path');
      if (path) loadPageContent(path);
    });
  });

  // Legal popup logic
  const legalPopup = document.getElementById('legal-popup');
  const lastAccepted = localStorage.getItem('legalPopupAccepted');
  const now = new Date().getTime();
  const thirtyDays = 1000 * 60 * 60 * 24 * 30;

  if (!lastAccepted || now - parseInt(lastAccepted) > thirtyDays) {
    legalPopup.style.display = 'block';
  }

  const acceptBtn = document.getElementById('accept-link');
  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      localStorage.setItem('legalPopupAccepted', Date.now().toString());
      legalPopup.style.display = 'none';
    });
  }
});
