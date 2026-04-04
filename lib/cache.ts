// Cache utilities for browser-based caching with TTL support

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  ttl: number; // Time to live in milliseconds
}

class CacheManager {
  private readonly prefix = 'mira_cache_';

  // Set cache with TTL
  set<T>(key: string, data: T, ttlMs: number = 5 * 60 * 1000): void {
    try {
      const entry: CacheEntry<T> = {
        data,
        timestamp: Date.now(),
        ttl: ttlMs
      };
      localStorage.setItem(this.prefix + key, JSON.stringify(entry));
    } catch (error) {
      console.warn('Failed to set cache:', error);
    }
  }

  // Get cache, returns null if expired or not found
  get<T>(key: string): T | null {
    try {
      const item = localStorage.getItem(this.prefix + key);
      if (!item) return null;

      const entry: CacheEntry<T> = JSON.parse(item);
      const now = Date.now();

      // Check if cache is expired
      if (now - entry.timestamp > entry.ttl) {
        this.delete(key);
        return null;
      }

      return entry.data;
    } catch (error) {
      console.warn('Failed to get cache:', error);
      this.delete(key); // Clean up corrupted cache
      return null;
    }
  }

  // Delete specific cache entry
  delete(key: string): void {
    try {
      localStorage.removeItem(this.prefix + key);
    } catch (error) {
      console.warn('Failed to delete cache:', error);
    }
  }

  // Clear all cache entries
  clear(): void {
    try {
      const keys = Object.keys(localStorage);
      keys.forEach(key => {
        if (key.startsWith(this.prefix)) {
          localStorage.removeItem(key);
        }
      });
    } catch (error) {
      console.warn('Failed to clear cache:', error);
    }
  }

  // Clear expired cache entries
  clearExpired(): void {
    try {
      const keys = Object.keys(localStorage);
      const now = Date.now();

      keys.forEach(key => {
        if (key.startsWith(this.prefix)) {
          try {
            const entry: CacheEntry<any> = JSON.parse(localStorage.getItem(key) || '{}');
            if (now - entry.timestamp > entry.ttl) {
              localStorage.removeItem(key);
            }
          } catch {
            localStorage.removeItem(key); // Remove corrupted entries
          }
        }
      });
    } catch (error) {
      console.warn('Failed to clear expired cache:', error);
    }
  }

  // Check if cache exists and is valid
  isValid(key: string): boolean {
    return this.get(key) !== null;
  }

  // Get cache age in milliseconds
  getAge(key: string): number {
    try {
      const item = localStorage.getItem(this.prefix + key);
      if (!item) return -1;

      const entry: CacheEntry<any> = JSON.parse(item);
      return Date.now() - entry.timestamp;
    } catch {
      return -1;
    }
  }
}

// Export singleton instance
export const cache = new CacheManager();

// Cache keys constants
export const CACHE_KEYS = {
  USER_PROFILE: 'user_profile',
  CHAT_LIST: 'chat_list',
  CHAT_PARTICIPANTS: (chatId: string) => `chat_participants_${chatId}`,
  USER_SEARCH: (query: string) => `user_search_${query}`,
  UNREAD_MESSAGES: 'unread_messages',
  LAST_READ_MESSAGES: (chatId: string) => `last_read_${chatId}`,
  RECENT_CHAT_ACCESS: 'recent_chat_access', // Track when chats were last accessed
  CHAT_MESSAGES: (chatId: string) => `chat_messages_${chatId}`, // Cache initial message load
} as const;

// TTL constants (in milliseconds)
export const CACHE_TTL = {
  USER_PROFILE: 10 * 60 * 1000, // 10 minutes
  CHAT_LIST: 2 * 60 * 1000, // 2 minutes
  CHAT_PARTICIPANTS: 5 * 60 * 1000, // 5 minutes
  USER_SEARCH: 5 * 60 * 1000, // 5 minutes
  UNREAD_MESSAGES: 24 * 60 * 60 * 1000, // 24 hours
  LAST_READ_MESSAGES: 7 * 24 * 60 * 60 * 1000, // 7 days
  RECENT_CHAT_ACCESS: 7 * 24 * 60 * 60 * 1000, // 7 days for access tracking
  CHAT_MESSAGES: 30 * 60 * 1000, // 30 minutes for message cache
} as const;
