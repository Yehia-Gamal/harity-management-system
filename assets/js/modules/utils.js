(function () {
  function escapeHtml(value) {
    return (value || '').toString()
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function debounce(fn, wait = 200) {
    let timer = null;
    return function debounced(...args) {
      try { if (timer) clearTimeout(timer); } catch { }
      timer = setTimeout(() => {
        try { fn.apply(this, args); } catch { }
      }, wait);
    };
  }

  function clampNumber(value, min, max, fallback) {
    const n = Number(value);
    const base = Number.isFinite(n) ? n : fallback;
    return Math.max(min, Math.min(max, base));
  }

  function coerceArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function formatDateTime(value) {
    const text = (value || '').toString().trim();
    if (!text) return '';
    return text.replace('T', ' ').replace('Z', '');
  }

  window.CharityUtils = Object.freeze({
    escapeHtml,
    debounce,
    clampNumber,
    coerceArray,
    formatDateTime
  });
})();
