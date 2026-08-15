(function initializeTheme() {
  const STORAGE_KEY = 'lhwiki:theme';
  const MODES = new Set(['system', 'light', 'dark']);
  const root = document.documentElement;
  const media = window.matchMedia('(prefers-color-scheme: dark)');

  function preference() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return MODES.has(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  }

  function effective(mode = preference()) {
    return mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
  }

  function apply(mode = preference(), { persist = false } = {}) {
    const safeMode = MODES.has(mode) ? mode : 'system';
    if (safeMode === 'system') root.removeAttribute('data-theme');
    else root.dataset.theme = safeMode;
    root.dataset.themeEffective = effective(safeMode);
    root.style.colorScheme = effective(safeMode);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = effective(safeMode) === 'dark' ? '#202321' : '#f5f1e9';
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, safeMode); } catch { /* private mode can disable storage */ }
    }
    window.dispatchEvent(new CustomEvent('lhwiki-theme-change', { detail: { preference: safeMode, effective: effective(safeMode) } }));
    return safeMode;
  }

  media.addEventListener?.('change', () => { if (preference() === 'system') apply('system'); });
  window.LHTheme = Object.freeze({ apply, effective, preference, modes: ['system', 'light', 'dark'] });
  apply();
})();
