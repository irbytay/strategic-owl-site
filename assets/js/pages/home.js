/* Behavior migrated from index.html. */
// 🧠 Homepage dynamic: homepage story only

  const HOMEPAGE_SHEET_ID = "19wBEj9hEkvIyQcoR5E_mBGVAxTzMnddMxk8nuQLAumA";
  const HOMEPAGE_API_KEY = "AIzaSyCzuh9HBfe0r70r9U35Pe406PPZ-tz6I78";
  const RANGE_STORY = "Homepage!C9:C19";
  const RANGE_MISSION_TIMESTAMP = "Homepage!C3";
  const RANGE_MISSION_UPDATES = "Homepage!C4:C6";

  function escapeHtml(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  async function fetchHomepageData() {
    const url = new URL(`https://sheets.googleapis.com/v4/spreadsheets/${HOMEPAGE_SHEET_ID}/values:batchGet`);
    url.searchParams.set('key', HOMEPAGE_API_KEY);
    url.searchParams.append('ranges', RANGE_MISSION_TIMESTAMP);
    url.searchParams.append('ranges', RANGE_MISSION_UPDATES);
    url.searchParams.append('ranges', RANGE_STORY);

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Sheets fetch failed: ${res.status}`);
    const json = await res.json();

    const out = {
      missionTimestamp: '',
      missionUpdates: [],
      story: {
        h1: '', b1: '',
        h2: '', b2: '',
        h3: '', b3: '',
        h4: '', b4: '',
        h5: '', b5: '',
        closing: ''
      }
    };

    const ranges = json.valueRanges || [];
    for (const vr of ranges) {
      const r = vr.range || '';

      if (r.includes('Homepage!C3')) {
        out.missionTimestamp = (vr.values && vr.values[0] && vr.values[0][0]) ? vr.values[0][0].toString() : '';
      }

      if (r.includes('Homepage!C4')) {
        const v = vr.values || [];
        out.missionUpdates = v
          .map((row) => row && row[0] ? row[0].toString().trim() : '')
          .filter(Boolean);
      }

      if (r.includes('Homepage!C9')) {
        const v = vr.values || [];
        const get = (idx) => (v[idx] && v[idx][0]) ? v[idx][0].toString() : '';

        out.story.h1 = get(0);
        out.story.b1 = get(1);
        out.story.h2 = get(2);
        out.story.b2 = get(3);
        out.story.h3 = get(4);
        out.story.b3 = get(5);
        out.story.h4 = get(6);
        out.story.b4 = get(7);
        out.story.h5 = get(8);
        out.story.b5 = get(9);
        out.story.closing = get(10);
      }
    }

    return out;
  }

  async function initHomepageDynamic() {
    try {
      const data = await fetchHomepageData();

      const timestampEl = document.getElementById('mission-update-timestamp');
      if (timestampEl && data.missionTimestamp) {
        timestampEl.textContent = data.missionTimestamp;
      }

      const updatesEl = document.getElementById('mission-update-list');
      if (updatesEl && Array.isArray(data.missionUpdates) && data.missionUpdates.length) {
        updatesEl.innerHTML = data.missionUpdates
          .map((update) => `<div style="font-family: 'Inter', sans-serif; color: var(--understanding); font-size: 1rem; line-height: 1.45; text-align: center; max-width: 720px;">${escapeHtml(update)}</div>`)
          .join('');
      }

      const storyCard = document.getElementById('homepage-story-card');
      if (!storyCard) return;

      const s = data.story || {};
      const hasStory = [
        s.h1, s.b1, s.h2, s.b2, s.h3, s.b3, s.h4, s.b4, s.h5, s.b5, s.closing
      ].some(x => (x || '').trim());

      if (!hasStory) return;

      const section = (h, b) => {
        const hh = (h || '').trim();
        const bb = (b || '').trim();
        if (!hh && !bb) return '';
        return `
          ${hh ? `<div style="text-align:center; font-family:'Times New Roman', Times, serif; font-size:20px; font-weight:700; color: var(--understanding); margin-top: 10px;">${escapeHtml(hh)}</div>` : ''}
          ${bb ? `<div style="text-align:center; font-family:'Inter', sans-serif; font-size: 1.02rem; color: var(--text-muted); line-height: 1.7; margin-top: 10px; white-space: pre-wrap;">${escapeHtml(bb)}</div>` : ''}
        `;
      };

      storyCard.innerHTML = `
        <div style="text-align:center; font-family:'Merriweather', serif; font-size:18px; font-style: italic; color:#BFA85B; margin-bottom: 10px;">Welcome in. Appreciate you.</div>
        ${section(s.h1, s.b1)}
        ${section(s.h2, s.b2)}
        ${section(s.h3, s.b3)}
        ${section(s.h4, s.b4)}
        ${section(s.h5, s.b5)}
        ${(s.closing || '').trim()
          ? `<div style="margin-top: 16px; text-align:center; font-family:'Merriweather', serif; font-size:14px; font-style: italic; color:#BFA85B; white-space: pre-wrap;">${escapeHtml((s.closing || '').trim())}</div>`
          : ''
        }
      `;

      storyCard.style.display = 'block';
    } catch (e) {
      console.warn('Homepage story failed:', e);
    }
  }

  window.addEventListener('DOMContentLoaded', initHomepageDynamic);

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
