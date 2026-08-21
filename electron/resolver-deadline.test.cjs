'use strict';

const {
  createResolverContext,
  awaitResolverStep
} = require('./resolver-deadline.cjs');

async function runResolverDeadlineFixture() {
  const never = new Promise(() => {});
  const controller = new AbortController();
  const cancelled = awaitResolverStep(
    never,
    createResolverContext({ signal: controller.signal, timeoutMs: 1000 }),
    'Hanging cancellation fixture'
  ).catch(error => error.stage);
  controller.abort();
  const cancelledStage = await cancelled;

  const timeoutStage = await awaitResolverStep(
    never,
    createResolverContext({ timeoutMs: 15 }),
    'Hanging timeout fixture'
  ).catch(error => error.stage);

  if (cancelledStage !== 'DOWNLOAD_CANCELLED' || timeoutStage !== 'DIRECT_RANGE_RESOLVE_TIMEOUT') {
    throw new Error(`Resolver deadline mismatch: ${cancelledStage}/${timeoutStage}`);
  }
  return { cancelledStage, timeoutStage };
}

if (require.main === module) runResolverDeadlineFixture().then(result => console.log(JSON.stringify(result)));
module.exports = { runResolverDeadlineFixture };
