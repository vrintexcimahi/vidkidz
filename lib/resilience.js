/**
 * VIDKIDZ Resilience & Concurrency Management
 * Modul ketahanan untuk operasi I/O, AI Vision, dan kompresi media.
 */

// Semaphore untuk membatasi operasi berat CPU/RAM secara simultan
class Semaphore {
  constructor(maxConcurrency = 2) {
    this.max = maxConcurrency;
    this.current = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.current < this.max) {
      this.current++;
      return;
    }
    await new Promise(resolve => this.queue.push(resolve));
    this.current++;
  }

  release() {
    this.current--;
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    }
  }

  async run(task) {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.release();
    }
  }
}

// Circuit Breaker untuk melindungi dari upstream 9Router yang hang/down
class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name;
    this.failureThreshold = options.failureThreshold || 3;
    this.resetTimeout = options.resetTimeout || 30000; // 30 detik
    this.state = 'CLOSED'; // 'CLOSED', 'OPEN', 'HALF_OPEN'
    this.failureCount = 0;
    this.lastFailureTime = 0;
  }

  isOpen() {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        this.state = 'HALF_OPEN';
        return false;
      }
      return true;
    }
    return false;
  }

  recordSuccess() {
    this.failureCount = 0;
    this.state = 'CLOSED';
  }

  recordFailure() {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.warn(`[CIRCUIT-BREAKER] ${this.name} status sekarang: OPEN (Threshold ${this.failureThreshold} tercapai)`);
    }
  }

  reset() {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.state = 'CLOSED';
  }
}

// Cache TTL untuk hasil AI Vision
class TtlCache {
  constructor(ttlMs = 5 * 60 * 1000, maxItems = 100) {
    this.ttlMs = ttlMs;
    this.maxItems = maxItems;
    this.cache = new Map();
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    if (Date.now() > item.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return item.value;
  }

  set(key, value) {
    if (this.cache.size >= this.maxItems) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

module.exports = { Semaphore, CircuitBreaker, TtlCache };
