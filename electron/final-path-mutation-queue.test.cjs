'use strict';

const { FinalPathMutationQueue } = require('./final-path-mutation-queue.cjs');

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runFinalPathMutationStressTest() {
  const queue = new FinalPathMutationQueue('win32');
  const events = [];
  const target = 'C:\\Music\\Artist - Song.mp3';

  const commit = queue.run(target, async () => {
    events.push('commit:start');
    await delay(25);
    events.push('commit:end');
  });
  const exportWrite = queue.run('c:\\music\\ARTIST - SONG.mp3', async () => {
    events.push('export:start');
    await delay(2);
    events.push('export:end');
  });
  const deletion = queue.run(target, async () => {
    events.push('delete:start');
    events.push('delete:end');
  });
  const otherPath = queue.run('C:\\Music\\Other.mp3', async () => {
    events.push('other:start');
    events.push('other:end');
  });

  await Promise.all([commit, exportWrite, deletion, otherPath]);
  const samePathEvents = events.filter(event => !event.startsWith('other:'));
  const expected = ['commit:start', 'commit:end', 'export:start', 'export:end', 'delete:start', 'delete:end'];
  if (JSON.stringify(samePathEvents) !== JSON.stringify(expected)) {
    throw new Error(`Same-path mutation order mismatch: ${samePathEvents.join(',')}`);
  }
  if (queue.pendingPathCount() !== 0) throw new Error('Final-path queue did not clean its tails');
  return { events, pendingPathCount: queue.pendingPathCount() };
}

if (require.main === module) {
  runFinalPathMutationStressTest()
    .then(result => console.log(JSON.stringify(result)))
    .catch(error => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = { runFinalPathMutationStressTest };
