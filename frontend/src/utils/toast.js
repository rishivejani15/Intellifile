export const TOAST_EVENT = 'intellifile-toast';

export function showToast(message, options = {}) {
  const type = options.type || 'info';
  const detail = {
    type,
    title: options.title || (type === 'success' ? 'Success' : type === 'warning' ? 'Warning' : type === 'error' ? 'Error' : 'Info'),
    message: message || '',
    reason: options.reason || '',
    solution: options.solution || '',
    duration: typeof options.duration === 'number' ? options.duration : 4500,
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }));
  }

  return detail;
}

export function showErrorToast(message, reason, solution) {
  return showToast(message, {
    type: 'error',
    reason,
    solution,
    title: 'Error',
  });
}
