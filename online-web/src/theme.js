const THEME_KEY = 'lotto_theme';

export function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'system';
}

export function applyTheme(theme) {
  if (theme === 'system') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme);
  applyTheme(theme);
}
