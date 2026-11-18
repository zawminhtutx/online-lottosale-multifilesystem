// Phone look (the online-mobile app's screens) vs the desktop POS look. The phone look is used on a
// narrow screen, or always when the page was opened as a mini app inside another app (?embed=1 —
// remembered for the tab, since links inside the app drop the query string).
import { useEffect, useState } from 'react';

const EMBED_KEY = 'online_embed';
const QUERY = '(max-width: 820px)';

export function isEmbedded() {
  try {
    const q = new URLSearchParams(window.location.search).get('embed');
    if (q === '1') sessionStorage.setItem(EMBED_KEY, '1');
    if (q === '0') sessionStorage.removeItem(EMBED_KEY);
    return sessionStorage.getItem(EMBED_KEY) === '1';
  } catch {
    return false;
  }
}

const narrow = () => window.matchMedia?.(QUERY).matches ?? false;
const mobileUA = () => /Android|iPhone|iPad|iPod|IEMobile|Opera Mini/i.test(navigator.userAgent ?? '');

export function useMobile() {
  const [mobile, setMobile] = useState(() => isEmbedded() || narrow() || mobileUA());
  useEffect(() => {
    if (isEmbedded()) return undefined;
    const mq = window.matchMedia?.(QUERY);
    if (!mq) return undefined;
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}
