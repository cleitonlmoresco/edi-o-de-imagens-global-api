// Cache em memória de resultados. As chaves de API ficam apenas no servidor proxy (server/).

const responseCache = new Map();

export const StorageService = {
  getCachedResult(cacheKey) {
    return responseCache.get(cacheKey) || null;
  },

  setCachedResult(cacheKey, value) {
    responseCache.set(cacheKey, value);
  },

  clearCache() {
    responseCache.clear();
  },
};
