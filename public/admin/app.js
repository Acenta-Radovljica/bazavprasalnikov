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
    <div class="flex items-center justify-between px-6 py-3 bg-[#1a1a2e] text-white">
      <a href="/admin/" class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-full bg-[#00b894] flex items-center justify-center font-bold">A</div>
        <span class="font-semibold">Acenta — Baza vprašalnikov</span>
      </a>
      <nav class="flex gap-4 text-sm">
        <a href="/admin/" class="${active === 'home' ? 'text-[#00b894]' : 'hover:text-[#00b894]'}">Podjetja</a>
        <a href="/admin/search.html" class="${active === 'search' ? 'text-[#00b894]' : 'hover:text-[#00b894]'}">Iskanje</a>
        <a href="/admin/insights.html" class="${active === 'insights' ? 'text-[#00b894]' : 'hover:text-[#00b894]'}">Cross-client</a>
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
