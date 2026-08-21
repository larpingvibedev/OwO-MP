'use strict';

const { deriveDirectStreamIdentity, decideDirectStreamRefresh } = require('./direct-stream-identity.cjs');

function runDirectStreamIdentityFixture() {
  const first = deriveDirectStreamIdentity({
    clientName: 'TV',
    url: 'https://r.test/videoplayback?id=streamA&itag=140&mime=audio%2Fmp4%3B%20codecs%3D%22mp4a.40.2%22&clen=5000'
  }, 5000);
  const refreshedSame = deriveDirectStreamIdentity({
    clientName: 'TV',
    url: 'https://other.test/videoplayback?id=streamA&itag=140&mime=audio%2Fmp4%3B%20codecs%3D%22mp4a.40.2%22&clen=5000&sig=new'
  }, 5000);
  const different = deriveDirectStreamIdentity({
    clientName: 'TV',
    url: 'https://other.test/videoplayback?id=streamB&itag=140&mime=audio%2Fmp4%3B%20codecs%3D%22mp4a.40.2%22&clen=5000'
  }, 5000);
  const missingId = deriveDirectStreamIdentity({
    clientName: 'TV',
    url: 'https://r.test/videoplayback?itag=140&mime=audio%2Fmp4%3B%20codecs%3D%22mp4a.40.2%22&clen=5000'
  }, 5000);
  const missingItag = deriveDirectStreamIdentity({
    clientName: 'TV',
    url: 'https://r.test/videoplayback?id=streamA&mime=audio%2Fmp4%3B%20codecs%3D%22mp4a.40.2%22&clen=5000'
  }, 5000);
  const missingCodec = deriveDirectStreamIdentity({
    clientName: 'TV',
    url: 'https://r.test/videoplayback?id=streamA&itag=140&mime=audio%2Fmp4&clen=5000'
  }, 5000);
  const missingMime = deriveDirectStreamIdentity({
    clientName: 'TV', codec: 'mp4a.40.2',
    url: 'https://r.test/videoplayback?id=streamA&itag=140&clen=5000'
  }, 5000);
  const placeholderId = deriveDirectStreamIdentity({
    clientName: 'TV',
    url: 'https://r.test/videoplayback?id=unknown&itag=140&mime=audio%2Fmp4%3B%20codecs%3D%22mp4a.40.2%22&clen=5000'
  }, 5000);
  const placeholderFields = deriveDirectStreamIdentity({
    clientName: 'N-A', codec: 'none',
    url: 'https://r.test/videoplayback?id=0&itag=0&mime=audio%2Funknown&clen=5000'
  }, 5000);
  if (missingId || missingItag || missingCodec || missingMime || placeholderId || placeholderFields) {
    throw new Error('Incomplete stream identity was accepted');
  }
  if (first !== refreshedSame || first === different) throw new Error('Direct stream identity binding failed');
  const firstMismatch = decideDirectStreamRefresh(first, different, 1048576, 0);
  const repeatedMismatch = decideDirectStreamRefresh(first, different, 1048576, 1);
  const missingRefresh = decideDirectStreamRefresh(first, null, 1048576, 0);
  if (firstMismatch !== 'restart' || repeatedMismatch !== 'fail' || missingRefresh !== 'fail') {
    throw new Error('Direct stream restart bound failed');
  }
  return {
    sameRefresh: first === refreshedSame,
    missingRejected: [missingId, missingItag, missingCodec, missingMime, placeholderId, placeholderFields]
      .every(value => value === null),
    firstMismatch,
    repeatedMismatch,
    missingRefresh
  };
}

if (require.main === module) console.log(JSON.stringify(runDirectStreamIdentityFixture()));
module.exports = { runDirectStreamIdentityFixture };
