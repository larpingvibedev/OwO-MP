'use strict';

class YouTubeRequestDispatcher {
  constructor(shouldBlock) {
    this.shouldBlock = shouldBlock;
    this.observers = new Map();
    this.nextObserverId = 1;
  }

  addObserver(observer) {
    const observerId = this.nextObserverId++;
    this.observers.set(observerId, observer);
    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.observers.delete(observerId);
    };
  }

  dispatch(details, callback) {
    // Observers are diagnostic/read-only. They cannot affect the single
    // authoritative ad-block decision or Electron callback ownership.
    const observerDetails = Object.freeze({ ...details });
    for (const observer of Array.from(this.observers.values())) {
      try { observer(observerDetails); } catch (error) {
        console.warn('[YouTube Request Observer Error]:', error?.message || error);
      }
    }
    callback({ cancel: Boolean(this.shouldBlock(details.url, details.resourceType)) });
  }

  observerCount() {
    return this.observers.size;
  }
}

module.exports = { YouTubeRequestDispatcher };
