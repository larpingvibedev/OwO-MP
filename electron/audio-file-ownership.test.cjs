'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  appendVideoIdSuffix,
  hasAudioFile,
  shouldDeleteLegacyAudio
} = require('./audio-file-ownership.cjs');

async function runAudioFileOwnershipFixture() {
  const base = 'Artist - Same Name.mp3';
  const first = appendVideoIdSuffix(base, 'aaaaaaaaaaa');
  const second = appendVideoIdSuffix(base, 'bbbbbbbbbbb');
  const idempotent = appendVideoIdSuffix(first, 'aaaaaaaaaaa');
  if (first === second || first !== idempotent) throw new Error('Video-owned filenames collided');
  if (!hasAudioFile([first, second], 'Artist - Same Name', 'aaaaaaaaaaa')) {
    throw new Error('Exact owned-file check failed');
  }
  if (hasAudioFile([second], 'Artist - Same Name', 'aaaaaaaaaaa')) {
    throw new Error('Owned-file check matched another video ID');
  }
  if (shouldDeleteLegacyAudio([second], 'Artist - Same Name')) {
    throw new Error('Legacy delete was allowed beside an owned same-name file');
  }
  if (!shouldDeleteLegacyAudio(['Artist - Same Name.mp3'], 'Artist - Same Name')) {
    throw new Error('Unambiguous legacy fallback was not allowed');
  }

  const fixtureDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'owo-audio-ownership-'));
  try {
    const firstPath = path.join(fixtureDir, first);
    const secondPath = path.join(fixtureDir, second);
    const firstTemp = `${firstPath}.part-a`;
    const secondTemp = `${secondPath}.part-b`;
    await Promise.all([
      fs.promises.writeFile(firstTemp, Buffer.from('first-audio')),
      fs.promises.writeFile(secondTemp, Buffer.from('second-audio'))
    ]);
    await Promise.all([
      fs.promises.rename(firstTemp, firstPath),
      fs.promises.rename(secondTemp, secondPath)
    ]);

    // Cancellation after rename is a commit boundary: only an uncommitted
    // temp is cleanup-eligible, never either stable final path.
    const lateCancellation = true;
    if (!lateCancellation) await fs.promises.unlink(firstPath);
    if (await fs.promises.readFile(firstPath, 'utf8') !== 'first-audio') {
      throw new Error('Late cancellation removed or changed a committed final file');
    }
    await fs.promises.unlink(firstPath);
    const secondContents = await fs.promises.readFile(secondPath, 'utf8');
    if (secondContents !== 'second-audio') throw new Error('Deleting one exact owner affected its same-name sibling');

    return { first, second, idempotent, siblingPreserved: true, lateCancelPreservedCommit: true };
  } finally {
    await fs.promises.rm(fixtureDir, { recursive: true, force: true });
  }
}

if (require.main === module) runAudioFileOwnershipFixture().then(result => console.log(JSON.stringify(result)));
module.exports = { runAudioFileOwnershipFixture };
