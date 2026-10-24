// Runs before first paint so the page never flashes the wrong theme.
(function () {
  var theme = 'light';
  try {
    var saved = localStorage.getItem('pms-theme');
    theme = saved === 'dark' || saved === 'light' ? saved : matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch (e) {
    // Storage can be blocked; fall back to light.
  }
  document.documentElement.dataset.theme = theme;
})();
