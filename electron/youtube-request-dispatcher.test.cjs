'use strict';

const { YouTubeRequestDispatcher } = require('./youtube-request-dispatcher.cjs');

async function runYouTubeRequestDispatcherLifecycleTest() {
  const observed = [];
  const decisions = [];
  const dispatcher = new YouTubeRequestDispatcher(url => url.includes('/blocked/'));
  const removeA = dispatcher.addObserver(details => observed.push(`a:${details.id}`));
  const removeB = dispatcher.addObserver(details => observed.push(`b:${details.id}`));

  dispatcher.dispatch({ id: 1, url: 'https://example.test/allowed/', resourceType: 'media' }, result => decisions.push(result.cancel));
  removeA();
  dispatcher.dispatch({ id: 2, url: 'https://example.test/blocked/', resourceType: 'script' }, result => decisions.push(result.cancel));
  removeA(); // teardown is idempotent
  removeB();
  dispatcher.dispatch({ id: 3, url: 'https://example.test/allowed/', resourceType: 'media' }, result => decisions.push(result.cancel));

  const expectedObserved = ['a:1', 'b:1', 'b:2'];
  const expectedDecisions = [false, true, false];
  if (JSON.stringify(observed) !== JSON.stringify(expectedObserved)) {
    throw new Error(`Observer lifecycle mismatch: ${observed.join(',')}`);
  }
  if (JSON.stringify(decisions) !== JSON.stringify(expectedDecisions)) {
    throw new Error(`Ad-block decisions mismatch: ${decisions.join(',')}`);
  }
  if (dispatcher.observerCount() !== 0) {
    throw new Error('Observer registry did not clean up');
  }
  return { observed, decisions, observerCount: dispatcher.observerCount() };
}

if (require.main === module) {
  runYouTubeRequestDispatcherLifecycleTest()
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runYouTubeRequestDispatcherLifecycleTest };
