// ── Skupne helper funkcije za vse admin strani ────────────────────────────
// Vse strani so za isti origin in basic auth se prenese avtomatsko (brskalnik
// cache-a kredencije po prvi prijavi).

// API fetch — vrne JSON ali null ob napaki.
async function apiFetch(path, options = {}) {
  try {
    const res = await fetch(path, {
      ...options,
      headers: {
        'content-type': 'application/json',
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      console.error('[api] HTTP', res.status, path);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.error('[api] fetch napaka:', err.message);
    return null;
  }
}

// Format datuma — slovensko, brez sekund.
function formatDatum(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('sl-SI', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// HTML escape — varno za injection v innerHTML.
function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Query parameter helper.
function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Navigacija header — vstavi v <header id="nav"></header>
function renderNav(active = '') {
  const html = `
    <div class="flex items-center justify-between px-8 py-4 bg-[#15151f] text-white">
      <a href="/admin/" class="flex items-center gap-3" style="text-decoration:none; color:inherit;">
        <div style="width:36px; height:36px; border-radius:12px; background:linear-gradient(135deg,#00b894 0%,#019272 100%); display:flex; align-items:center; justify-content:center; font-family:'Fraunces',serif; font-weight:500; font-size:20px; color:#fff; box-shadow:0 6px 14px -4px rgba(0,184,148,0.5);">a</div>
        <span style="font-family:'Fraunces',serif; font-size:18px; font-weight:500; letter-spacing:-0.015em;">Acenta — Baza vprašalnikov</span>
      </a>
      <nav class="flex gap-6 text-sm">
        <a href="/admin/" class="${active === 'home' ? 'text-[#00b894]' : 'hover:text-[#00b894]'} font-medium transition-colors">Podjetja</a>
        <a href="/admin/questionnaires.html" class="${active === 'questionnaires' ? 'text-[#00b894]' : 'hover:text-[#00b894]'} font-medium transition-colors">Vprašalniki</a>
        <a href="/admin/search.html" class="${active === 'search' ? 'text-[#00b894]' : 'hover:text-[#00b894]'} font-medium transition-colors">Iskanje</a>
        <a href="/admin/insights.html" class="${active === 'insights' ? 'text-[#00b894]' : 'hover:text-[#00b894]'} font-medium transition-colors">Cross-client</a>
      </nav>
    </div>
  `;
  const el = document.getElementById('nav');
  if (el) el.innerHTML = html;
}

// Spinner / loading state helper.
function showLoading(targetId, msg = 'Nalagam...') {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = `<div class="text-center text-gray-500 py-12">${esc(msg)}</div>`;
}

function showError(targetId, msg) {
  const el = document.getElementById(targetId);
  if (el) el.innerHTML = `<div class="bg-red-50 text-red-700 p-4 rounded">${esc(msg)}</div>`;
}
