/* The Perch feed: the same public Supabase source used by Flutter feed.dart. */
  const SUPABASE_URL = "https://gopyzkcmvkbusdnwjlbb.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_CYM_aXzslre6SE8P-tTYBw_sw_-gQ1h";

  function soToast(msg) {
    const el = document.getElementById('so-toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    window.clearTimeout(el.__t);
    el.__t = window.setTimeout(() => el.classList.remove('show'), 2400);
  }

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatFeedTimestamp(rawTimestamp) {
    const date = new Date(String(rawTimestamp || ''));
    if (Number.isNaN(date.getTime())) return 'Recently';

    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      month: 'numeric',
      day: 'numeric',
      year: '2-digit',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type)?.value || '';

    return `${part('month')}/${part('day')}/${part('year')} • ${part('hour')}:${part('minute')} ${part('dayPeriod')} ET`;
  }

  function parseFeedImageUrl(rawValue) {
    const value = String(rawValue || '').trim();
    if (!value || value.toLowerCase() === 'null') return '';

    try {
      const url = new URL(value);
      return url.protocol === 'https:' || url.protocol === 'http:' ? value : '';
    } catch (_) {
      return '';
    }
  }

  function resolvePostSubject(rawSubject, dailyOwlLogic) {
    const subject = String(rawSubject || '').trim();
    if (subject && subject.toLowerCase() !== 'null') return subject;

    const fallback = String(dailyOwlLogic || '').replace(/\s+/g, ' ').trim();
    return fallback || 'Owl Logic';
  }

  async function fetchPerchFeed() {
    const url = new URL(`${SUPABASE_URL}/rest/v1/owl_posts`);
    url.searchParams.set(
      'select',
      'id,subject,daily_owl_logic,strategic_positioning,image_url,post_time',
    );
    url.searchParams.set('order', 'post_time.desc');

    const response = await fetch(url.toString(), {
      headers: {
        Accept: 'application/json',
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase feed request failed: ${response.status}`);
    }

    const rows = await response.json();
    if (!Array.isArray(rows)) return [];

    return rows.map((row, index) => {
      const dailyOwlLogic = String(row.daily_owl_logic || '').trim();
      const strategicPositioning = String(row.strategic_positioning || '').trim();

      return {
        id: String(row.id || `owl-post-${index}`),
        subject: resolvePostSubject(row.subject, dailyOwlLogic),
        dailyOwlLogic,
        strategicPositioning,
        imageUrl: parseFeedImageUrl(row.image_url),
        timestamp: formatFeedTimestamp(row.post_time),
      };
    }).filter((post) => post.dailyOwlLogic || post.strategicPositioning);
  }

  function buildFullPostText(post) {
    return [
      post.subject,
      'Owl Logic',
      post.dailyOwlLogic,
      'The Owl’s Position',
      post.strategicPositioning,
      post.timestamp === 'Recently'
        ? 'Taylor Irby • The Strategic Owl'
        : `Taylor Irby • The Strategic Owl\n${post.timestamp}`,
    ].filter((value) => String(value || '').trim()).join('\n\n');
  }

  async function copyText(text, label) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;

    try {
      await navigator.clipboard.writeText(cleanText);
      soToast(`Copied ${label}.`);
    } catch (e) {
      const ta = document.createElement('textarea');
      ta.value = cleanText;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      soToast(`Copied ${label}.`);
    }
  }

  async function shareText(text, title) {
    const cleanText = String(text || '').trim();
    if (!cleanText) return;

    if (navigator.share) {
      try {
        await navigator.share({ title, text: cleanText });
      } catch (_) {
        // User cancelled share sheet.
      }
    } else {
      await copyText(cleanText, title);
      soToast('Share not supported here. Copied instead.');
    }
  }

  function renderPerchPost(post) {
    return `
      <details class="so-card perch-post" data-post-id="${escapeHtml(post.id)}">
        <summary class="perch-post-summary">
          <div class="so-author-row">
            <img src="assets/images/founder-portrait.png" alt="Taylor Irby" class="so-author-avatar" onerror="this.style.display='none';" />
            <p class="so-author-meta">
              <span class="so-author-name">Taylor Irby</span>
              ${post.timestamp ? `<span class="so-author-time">${escapeHtml(post.timestamp)}</span>` : ''}
            </p>
            <img class="feed-card-brand-mark" src="assets/images/brand-title.png" alt="The Strategic Owl" />
          </div>
          <div class="perch-summary-main">
            ${post.imageUrl ? `
              <img
                src="${escapeHtml(post.imageUrl)}"
                alt=""
                class="perch-summary-image"
                loading="lazy"
                decoding="async"
              />
            ` : ''}
            <h2 class="so-post-subject">${escapeHtml(post.subject)}</h2>
            <span class="perch-summary-chevron" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"></path></svg>
            </span>
          </div>
        </summary>

        <div class="perch-post-details">
          <div class="so-card-title-row">
            <h3 class="so-card-title">Owl Logic</h3>
            <div class="so-actions">
              <button class="so-icon-btn" data-copy="daily" title="Copy Owl Logic" aria-label="Copy Owl Logic">
                <svg class="so-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm4 4H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 18H8V7h12v16z"/></svg>
              </button>
              <button class="so-icon-btn" data-share="daily" title="Share Owl Logic" aria-label="Share Owl Logic">
                <svg class="so-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a2.5 2.5 0 0 0 0-1.39l7.02-4.11A2.99 2.99 0 1 0 14 5a2.9 2.9 0 0 0 .04.49L7.02 9.6a3 3 0 1 0 0 4.8l7.02 4.11c-.03.16-.04.33-.04.49a3 3 0 1 0 3-2.92z"/></svg>
              </button>
            </div>
          </div>
          <div class="so-card-body">${escapeHtml(post.dailyOwlLogic)}</div>

          <div class="so-feed-section-spacer" aria-hidden="true"></div>

          <div class="so-card-title-row">
            <h3 class="so-card-title">The Owl’s Position</h3>
            <div class="so-actions">
              <button class="so-icon-btn" data-copy="position" title="Copy The Owl’s Position" aria-label="Copy The Owl’s Position">
                <svg class="so-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm4 4H8a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 18H8V7h12v16z"/></svg>
              </button>
              <button class="so-icon-btn" data-share="position" title="Share The Owl’s Position" aria-label="Share The Owl’s Position">
                <svg class="so-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a2.5 2.5 0 0 0 0-1.39l7.02-4.11A2.99 2.99 0 1 0 14 5a2.9 2.9 0 0 0 .04.49L7.02 9.6a3 3 0 1 0 0 4.8l7.02 4.11c-.03.16-.04.33-.04.49a3 3 0 1 0 3-2.92z"/></svg>
              </button>
            </div>
          </div>
          <div class="so-card-body italic">${escapeHtml(post.strategicPositioning)}</div>

          ${post.imageUrl ? `
            <div class="so-post-media">
              <img
                src="${escapeHtml(post.imageUrl)}"
                alt="Strategic Owl editorial artwork"
                class="so-post-image"
                loading="lazy"
                decoding="async"
              />
            </div>
          ` : ''}

          <div class="perch-full-post-action">
            <button class="perch-copy-full" data-copy="full" title="Copy full post" aria-label="Copy full post">
              Copy Full Post
            </button>
          </div>
        </div>
      </details>
    `;
  }

  function attachPerchActions(posts) {
    document.querySelectorAll('.perch-post').forEach((card) => {
      const post = posts.find((item) => item.id === card.dataset.postId);
      if (!post) return;

      const fullPost = buildFullPostText(post);

      card.querySelector('[data-copy="daily"]')?.addEventListener('click', () => copyText(post.dailyOwlLogic, 'Owl Logic'));
      card.querySelector('[data-share="daily"]')?.addEventListener('click', () => shareText(post.dailyOwlLogic, 'Daily Owl Logic'));
      card.querySelector('[data-copy="position"]')?.addEventListener('click', () => copyText(post.strategicPositioning, 'The Owl’s Position'));
      card.querySelector('[data-share="position"]')?.addEventListener('click', () => shareText(post.strategicPositioning, 'The Owl’s Position'));
      card.querySelector('[data-copy="full"]')?.addEventListener('click', () => copyText(fullPost, 'full post'));
    });
  }

  async function loadPerchFeed() {
    const list = document.getElementById('perch-feed-list');
    if (!list) return;

    list.innerHTML = `
      <div class="so-card">
        <p class="so-card-subtitle" style="text-align:center; margin:0;">Loading the latest Owl Logic…</p>
      </div>
    `;

    try {
      const posts = await fetchPerchFeed();

      if (!posts.length) {
        list.innerHTML = `
          <div class="so-card">
            <p class="so-card-subtitle" style="text-align:center; margin:0;">No feed posts are available right now.</p>
          </div>
        `;
        return;
      }

      list.innerHTML = posts.map(renderPerchPost).join('');
      attachPerchActions(posts);
    } catch (e) {
      console.warn('The Perch feed failed:', e);
      list.innerHTML = `
        <div class="so-card">
          <p class="so-card-subtitle" style="text-align:center; margin:0;">The feed could not load. Please refresh and try again.</p>
        </div>
      `;
    }
  }

  window.addEventListener('DOMContentLoaded', () => {
    loadPerchFeed();
    document.getElementById('refresh-feed')?.addEventListener('click', loadPerchFeed);
  });

// ⚖️ Legal popup (show on first visit or after 30 days)
  const legalPopup = document.getElementById('legal-popup');
  const lastAccepted = localStorage.getItem('legalPopupAccepted');
  const now = Date.now();
  const thirtyDays = 1000 * 60 * 60 * 24 * 30;

  if (legalPopup) {
    const last = parseInt(lastAccepted || '0', 10);
    if (!last || (now - last) > thirtyDays) {
      legalPopup.style.display = 'block';
    }

    const acceptLink = document.getElementById('accept-link');
    if (acceptLink) {
      acceptLink.addEventListener('click', () => {
        localStorage.setItem('legalPopupAccepted', Date.now().toString());
      });
    }
  }

  // 🍔 Mobile menu
  function toggleMenu() {
    const menu = document.getElementById('mobileMenu');
    if (!menu) return;
    menu.classList.toggle('show');
    menu.classList.toggle('open');
  }

// Auto-close mobile menu when clicking/tapping outside
  document.addEventListener('click', function (event) {
    const menu = document.getElementById('mobileMenu');
    const toggle = document.getElementById('menuToggle');

    if (!menu || !toggle) return;

    const isClickInsideMenu = menu.contains(event.target);
    const isClickOnToggle = toggle.contains(event.target);

    if (!isClickInsideMenu && !isClickOnToggle && menu.classList.contains('open')) {
      menu.classList.remove('open');
      menu.classList.remove('show');
    }
  });
