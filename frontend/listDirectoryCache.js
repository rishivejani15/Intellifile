function normalizeDirectoryKey(dirPath, showHidden) {
  const normalizedPath = String(dirPath || '').trim();
  return `${normalizedPath}::${Boolean(showHidden)}`;
}

function createListDirectoryController({ readDirectory, ttlMs = 5000 }) {
  const cache = new Map();
  const pending = new Map();

  return {
    async get(dirPath, options = {}) {
      const showHidden = Boolean(options?.showHidden);
      const key = normalizeDirectoryKey(dirPath, showHidden);
      const cached = cache.get(key);
      if (cached && Date.now() - cached.timestamp < ttlMs) {
        return cached.result;
      }

      if (pending.has(key)) {
        return pending.get(key);
      }

      const promise = (async () => {
        try {
          const result = await readDirectory(dirPath, options);
          cache.set(key, { result, timestamp: Date.now() });
          return result;
        } finally {
          pending.delete(key);
        }
      })();

      pending.set(key, promise);
      return promise;
    },
    clear() {
      cache.clear();
      pending.clear();
    }
  };
}

module.exports = { createListDirectoryController, normalizeDirectoryKey };
