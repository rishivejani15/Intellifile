// Use the app-themed confirmation modal when available, otherwise fall back to native confirm.
export async function confirmApp(message, items = []) {
  return new Promise((resolve) => {
    let resolved = false;

    const wrappedCb = (res) => {
      if (!resolved) {
        resolved = true;
        resolve(!!res);
      }
    };

    try {
      window.dispatchEvent(new CustomEvent('app-show-confirm', { detail: { items, callback: wrappedCb } }));
    } catch (e) {
      // ignore
    }

    const available = !!window.__app_confirm_available;
    const fallbackMs = available ? 30000 : 200;
    const fallback = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        try {
          resolve(window.confirm(message));
        } catch (e) {
          resolve(false);
        }
      }
    }, fallbackMs);

    // If the modal resolves earlier it will call wrappedCb and clear this timer indirectly
  });
}

export default confirmApp;
