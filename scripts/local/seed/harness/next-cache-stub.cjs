// Stand-in for `next/cache` while the LOCAL seeder runs outside Next.
//
// The real module throws outside a request ("Invariant: static generation
// store missing in revalidateTag", "incrementalCache missing in
// unstable_cache") because there is no Next server holding a cache. A seeder
// has nothing to cache and nothing to invalidate, so:
//
//   * unstable_cache(fn)  -> fn, uncached (every call reads the DB), but its
//                            result round-tripped through JSON as the real
//                            cache does — Dates become strings, `undefined`
//                            properties vanish, Maps/Sets become {} — so the
//                            seeder sees what the app would. A result of
//                            `undefined` itself stays `undefined`.
//   * revalidateTag / revalidatePath / updateTag / refresh -> no-op
//   * cacheTag / cacheLife / unstable_noStore / noStore    -> no-op
//
// Swapped in by ./register.mjs for the seeder process only. App code under
// lib/ and app/ is untouched and still gets the real module inside Next.
//
// Written as CommonJS with plain `exports.x =` assignments so both a
// `require('next/cache')` (tsx compiles lib/ to CJS) and an ESM
// `import { unstable_cache } from 'next/cache'` see named exports.
'use strict';

function noop() {}

exports.unstable_cache = function unstable_cache(fn) {
  return async function cached(...args) {
    const result = await fn(...args);
    return result === undefined
      ? undefined
      : JSON.parse(JSON.stringify(result));
  };
};
exports.revalidateTag = noop;
exports.revalidatePath = noop;
exports.updateTag = noop;
exports.refresh = noop;
exports.cacheTag = noop;
exports.cacheLife = noop;
exports.unstable_cacheTag = noop;
exports.unstable_cacheLife = noop;
exports.unstable_noStore = noop;
exports.noStore = noop;
exports.unstable_expirePath = noop;
exports.unstable_expireTag = noop;
