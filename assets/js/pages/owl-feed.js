/* The Perch feed: the same public Supabase source used by Flutter feed.dart. */
  const SUPABASE_URL = "https://gopyzkcmvkbusdnwjlbb.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY =
    "sb_publishable_CYM_aXzslre6SE8P-tTYBw_sw_-gQ1h";
  const OWL_POST_PAGES_URL = "https://owl-post-pages.irbytay.workers.dev";
  let perchSupabaseClient = null;
  let perchSessionPromise = null;

  function getPerchSupabaseClient() {
    if (perchSupabaseClient) return perchSupabaseClient;
    if (!window.supabase?.createClient) return null;

    perchSupabaseClient = window.supabase.createClient(
      SUPABASE_URL,
      SUPABASE_PUBLISHABLE_KEY,
      {
        auth: {
          autoRefreshToken: true,
          persistSession: true,
          detectSessionInUrl: false,
        },
      },
    );
    return perchSupabaseClient;
  }

  async function ensurePerchSession() {
    if (perchSessionPromise) return perchSessionPromise;

    perchSessionPromise = (async () => {
      const client = getPerchSupabaseClient();
      if (!client) throw new Error('Supabase browser client did not load.');

      const { data: sessionData, error: sessionError } = await client.auth.getSession();
      if (sessionError) throw sessionError;
      if (sessionData.session?.user?.id) return sessionData.session.user;

      const { data, error } = await client.auth.signInAnonymously();
      if (error) throw error;
      if (!data.user?.id) throw new Error('Supabase did not create an anonymous session.');
      return data.user;
    })();

    try {
      return await perchSessionPromise;
    } catch (error) {
      perchSessionPromise = null;
      throw error;
    }
  }

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

  function buildPostShareUrl(postId) {
    const url = new URL(OWL_POST_PAGES_URL);
    url.searchParams.set('id', String(postId || '').trim());
    return url.toString();
  }

  async function sharePost(post, text, title) {
    const cleanText = String(text || '').trim();
    const postUrl = buildPostShareUrl(post.id);
    if (!cleanText || !post.id) return;

    if (navigator.share) {
      try {
        await navigator.share({
          title: post.subject || title,
          text: cleanText,
          url: postUrl,
        });
      } catch (_) {
        // User cancelled share sheet.
      }
    } else {
      await copyText(`${cleanText}\n\n${postUrl}`, `${title} and post link`);
      soToast('Share not supported here. Post link copied instead.');
    }
  }

  function helpfulItemKey(postId, section) {
    return `owl_logic_feed:${postId}:${section}`;
  }

  function updateHelpfulButton(button, count, liked) {
    if (!button) return;
    button.disabled = false;
    button.dataset.liked = liked ? 'true' : 'false';
    button.setAttribute('aria-pressed', liked ? 'true' : 'false');
    button.classList.toggle('liked', liked);

    const label = button.querySelector('[data-helpful-label]');
    if (label) label.textContent = count > 0 ? `${count} Helpful` : 'Helpful';
  }

  async function refreshHelpfulStates(posts) {
    const validPosts = posts.filter((post) => String(post.id || '').trim());
    if (!validPosts.length) return;

    const user = await ensurePerchSession();
    const client = getPerchSupabaseClient();
    const itemKeys = validPosts.flatMap((post) => [
      helpfulItemKey(post.id, 'daily_owl_logic'),
      helpfulItemKey(post.id, 'strategic_positioning'),
    ]);

    const { data, error } = await client
      .from('likes')
      .select('item_key,user_id')
      .in('item_key', itemKeys);

    if (error) throw error;

    const counts = new Map();
    const mine = new Set();
    (data || []).forEach((row) => {
      counts.set(row.item_key, (counts.get(row.item_key) || 0) + 1);
      if (row.user_id === user.id) mine.add(row.item_key);
    });

    validPosts.forEach((post) => {
      const card = document.querySelector(`.perch-post[data-post-id="${CSS.escape(post.id)}"]`);
      if (!card) return;

      ['daily_owl_logic', 'strategic_positioning'].forEach((section) => {
        const key = helpfulItemKey(post.id, section);
        const button = card.querySelector(`[data-helpful="${section}"]`);
        updateHelpfulButton(button, counts.get(key) || 0, mine.has(key));
      });
    });
  }

  async function toggleHelpful(post, section, button) {
    if (!button || button.disabled) return;
    button.disabled = true;

    try {
      const user = await ensurePerchSession();
      const client = getPerchSupabaseClient();
      const itemKey = helpfulItemKey(post.id, section);
      const isLiked = button.dataset.liked === 'true';

      const request = isLiked
        ? client.from('likes').delete().eq('item_key', itemKey).eq('user_id', user.id)
        : client.from('likes').insert({ item_key: itemKey, user_id: user.id });
      const { error } = await request;
      if (error) throw error;

      await refreshHelpfulStates([post]);
      soToast(isLiked ? 'Helpful reaction removed.' : 'Marked as Helpful.');
    } catch (error) {
      console.warn('Helpful reaction failed:', error);
      button.disabled = false;
      soToast('Helpful is unavailable right now.');
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
            <button class="so-helpful-btn" data-helpful="daily_owl_logic" data-liked="false" type="button" aria-label="Mark Owl Logic as Helpful" aria-pressed="false" disabled>
              <svg class="so-helpful-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h4V9H1v12zm22-10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 2 7.59 8.59C7.22 8.95 7 9.45 7 10v9c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1z"/></svg>
              <span data-helpful-label>Helpful</span>
            </button>
          </div>
          <div class="so-card-body">${escapeHtml(post.dailyOwlLogic)}</div>

          <div class="so-feed-section-spacer" aria-hidden="true"></div>

          <div class="so-card-title-row">
            <h3 class="so-card-title">The Owl’s Position</h3>
            <button class="so-helpful-btn" data-helpful="strategic_positioning" data-liked="false" type="button" aria-label="Mark The Owl’s Position as Helpful" aria-pressed="false" disabled>
              <svg class="so-helpful-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M1 21h4V9H1v12zm22-10c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 2 7.59 8.59C7.22 8.95 7 9.45 7 10v9c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-1z"/></svg>
              <span data-helpful-label>Helpful</span>
            </button>
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
            <button class="perch-post-action-button" data-share="full" type="button" title="Share post" aria-label="Share post">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7a2.5 2.5 0 0 0 0-1.39l7.02-4.11A2.99 2.99 0 1 0 14 5a2.9 2.9 0 0 0 .04.49L7.02 9.6a3 3 0 1 0 0 4.8l7.02 4.11c-.03.16-.04.33-.04.49a3 3 0 1 0 3-2.92z"/></svg>
              <span>Share Post</span>
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

      card.querySelector('[data-helpful="daily_owl_logic"]')?.addEventListener('click', (event) => {
        toggleHelpful(post, 'daily_owl_logic', event.currentTarget);
      });
      card.querySelector('[data-helpful="strategic_positioning"]')?.addEventListener('click', (event) => {
        toggleHelpful(post, 'strategic_positioning', event.currentTarget);
      });
      card.querySelector('[data-share="full"]')?.addEventListener('click', () => sharePost(post, fullPost, post.subject));
    });

    refreshHelpfulStates(posts).catch((error) => {
      console.warn('Helpful totals failed to load:', error);
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
