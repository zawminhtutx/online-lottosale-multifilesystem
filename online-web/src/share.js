// Hands text/images off to whatever app the user picks (Viber, Telegram, SMS, etc.) via the
// OS/browser share sheet, since this app has no bot tokens or SMS gateway of its own — both
// Send-To options try the share sheet first (so the user can pick the destination app directly)
// and fall back to clipboard, then to a plain download for images, when Web Share isn't
// available (e.g. desktop browsers without share support).

// Also used directly by the "Save" Send-To option, for saving the voucher image locally
// without going through the share sheet at all.
export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// Returns 'shared' | 'copied' | 'failed'
export async function shareText(text) {
  if (navigator.share) {
    try {
      // Same reasoning as shareImage's own timeout below — some browser/OS combos leave this
      // promise pending forever once the target app (e.g. Telegram) opens and never hands control
      // back to the share sheet, which otherwise left the caller's "sending" UI state stuck
      // forever since the surrounding finally never runs. Bounding it guarantees recovery.
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 60000);
      });
      try {
        await Promise.race([navigator.share({ text }), timeout]);
        return 'shared';
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      if (e.name === 'AbortError') return 'shared';
      // fall through to clipboard — including on our own timeout above
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

// Returns 'shared' | 'copied' | 'downloaded' | 'failed'
export async function shareImage(blob, filename, text) {
  const file = new File([blob], filename, { type: blob.type || 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      // Some browser/OS combinations leave this promise pending forever if the native file
      // share sheet gets stuck (no compatible receiving app, or a flaky cancel path) — bound
      // it so the UI always recovers instead of staying stuck on "sending" indefinitely.
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('timeout')), 60000);
      });
      try {
        await Promise.race([navigator.share({ files: [file], text }), timeout]);
        return 'shared';
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      if (e.name === 'AbortError') return 'shared';
      // fall through to clipboard/download — including on our own timeout above
    }
  }
  try {
    if (window.ClipboardItem && navigator.clipboard?.write) {
      await navigator.clipboard.write([new window.ClipboardItem({ [file.type]: blob })]);
      return 'copied';
    }
  } catch {
    // fall through to download
  }
  try {
    downloadBlob(blob, filename);
    return 'downloaded';
  } catch {
    return 'failed';
  }
}
