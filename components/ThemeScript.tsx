// Inline script that runs before React hydrates. It applies the saved theme
// class to <html> synchronously, so the first paint is in the right mode
// (no flash of dark theme when the user prefers day, or vice versa).
export const themeScript = `
(function() {
  try {
    var t = localStorage.getItem('rush-theme');
    if (t === 'day') document.documentElement.classList.add('day');
  } catch (e) {}
})();
`.trim();
