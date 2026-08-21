'use strict';

const path = require('path');

class FinalPathMutationQueue {
  constructor(platform = process.platform) {
    this.platform = platform;
    this.tails = new Map();
  }

  normalize(finalPath) {
    const resolved = path.resolve(finalPath);
    return this.platform === 'win32' ? resolved.toLowerCase() : resolved;
  }

  run(finalPath, task) {
    const key = this.normalize(finalPath);
    const previous = this.tails.get(key) || Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(() => undefined, () => undefined);
    this.tails.set(key, settled);

    return run.finally(() => {
      if (this.tails.get(key) === settled) this.tails.delete(key);
    });
  }

  pendingPathCount() {
    return this.tails.size;
  }
}

module.exports = { FinalPathMutationQueue };
