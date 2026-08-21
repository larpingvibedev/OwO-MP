'use strict';

function resolverError(stage, message) {
  const error = new Error(`[${stage}] ${message}`);
  error.stage = stage;
  return error;
}

function createResolverContext(options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) && options.timeoutMs > 0 ? options.timeoutMs : 15000;
  return {
    callerSignal: options.signal || null,
    deadlineAt: Number.isFinite(options.deadlineAt) ? options.deadlineAt : Date.now() + timeoutMs
  };
}

function throwIfResolverExpired(context, description = 'Audio stream resolution') {
  if (context.callerSignal?.aborted) {
    throw resolverError('DOWNLOAD_CANCELLED', `${description} cancelled`);
  }
  if (Date.now() >= context.deadlineAt) {
    throw resolverError('DIRECT_RANGE_RESOLVE_TIMEOUT', `${description} timed out`);
  }
}

function getResolverFetchSignal(context) {
  throwIfResolverExpired(context);
  const remaining = Math.max(1, Math.ceil(context.deadlineAt - Date.now()));
  const timeoutSignal = AbortSignal.timeout(remaining);
  return context.callerSignal
    ? AbortSignal.any([context.callerSignal, timeoutSignal])
    : timeoutSignal;
}

async function awaitResolverStep(value, context, description) {
  throwIfResolverExpired(context, description);
  const remaining = Math.max(1, Math.ceil(context.deadlineAt - Date.now()));
  let timeoutId;
  let abortHandler;
  const deadlinePromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(
      resolverError('DIRECT_RANGE_RESOLVE_TIMEOUT', `${description} timed out`)
    ), remaining);
  });
  const abortPromise = context.callerSignal
    ? new Promise((_, reject) => {
        abortHandler = () => reject(resolverError('DOWNLOAD_CANCELLED', `${description} cancelled`));
        context.callerSignal.addEventListener('abort', abortHandler, { once: true });
      })
    : new Promise(() => {});

  // Promise.resolve attaches rejection observation even when the underlying
  // non-cancelable Innertube work settles after the deadline race is over.
  const observed = Promise.resolve(value).then(result => result, error => { throw error; });
  try {
    return await Promise.race([observed, deadlinePromise, abortPromise]);
  } finally {
    clearTimeout(timeoutId);
    if (abortHandler) context.callerSignal.removeEventListener('abort', abortHandler);
  }
}

function normalizeResolverError(error, context, description) {
  if (error?.stage) return error;
  if (context.callerSignal?.aborted) return resolverError('DOWNLOAD_CANCELLED', `${description} cancelled`);
  if (Date.now() >= context.deadlineAt || error?.name === 'TimeoutError' || error?.name === 'AbortError') {
    return resolverError('DIRECT_RANGE_RESOLVE_TIMEOUT', `${description} timed out`);
  }
  return error;
}

module.exports = {
  createResolverContext,
  throwIfResolverExpired,
  getResolverFetchSignal,
  awaitResolverStep,
  normalizeResolverError
};
