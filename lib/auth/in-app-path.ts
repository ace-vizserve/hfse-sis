// "Is this string somewhere inside THIS app?" — the open-redirect guard.
//
// WHY THIS EXISTS. Switching views used to always land on `/`. It still does
// from the profile popover, but the "not one of your classes" notice has to
// put the viewer back on the page they were already looking at, so the switch
// route now accepts a destination — and a destination supplied by the client
// is the classic open-redirect shape. Nothing here is exotic; it is exactly
// the check that is easy to write ALMOST right, which is why it is one pure
// function with its own tests rather than an inline `startsWith('/')`.
//
// ⚠ THE THREE NEAR-MISSES THIS IS WRITTEN AGAINST, all of which pass a naive
// `startsWith('/')`:
//
//   "//evil.example"     protocol-relative — the browser reads it as an
//                        absolute URL on another host, and it starts with "/".
//   "/\evil.example"     browsers normalise the backslash to "/", so this is
//                        the same attack wearing a different hat.
//   "/<TAB>https://evil" leading control characters and whitespace are
//                        STRIPPED by browsers before parsing, so a tab or a
//                        newline can smuggle a scheme past a naive prefix test.
//
// The final `new URL(...)` resolution is the belt to those braces: whatever
// the string is, if resolving it against an arbitrary origin lands anywhere
// but that origin, it is not in-app. The literal origin below is a throwaway
// used only as a resolution base — it is never fetched and never returned.

/** The base the check resolves against. `.invalid` is reserved (RFC 2606). */
const RESOLUTION_BASE = 'https://in-app-path-check.invalid';

/** Where a switch goes when no destination is given, or the one given is not in-app. */
export const DEFAULT_SWITCH_DESTINATION = '/';

/**
 * Any C0 control character, space, or DEL — anywhere in the string, not just
 * at the ends. Browsers strip tabs and newlines from inside a URL, so a path
 * carrying an embedded tab before a scheme is a smuggling attempt rather than
 * an odd-looking path. No legitimate destination in this app contains one; a
 * real space arrives percent-encoded.
 *
 * ⚠ Built from a STRING of escape sequences rather than written as a regex
 * literal, deliberately: a literal control character in this source would be
 * invisible to every reader and to code review, and it turns the file into
 * something `git`, `grep` and `file` all report as binary. Do not "simplify"
 * this back to a literal.
 */
const CONTROL_OR_SPACE = new RegExp('[\\u0000-\\u0020\\u007f]');

/**
 * Returns the normalised in-app path, or `null` if the input is anything else.
 *
 * Callers should treat `null` as "send them to `/` instead", NOT as an error to
 * surface: the switch itself is legitimate and refusing it would strand the
 * viewer in the view they are trying to leave. The rejection is silent by
 * design — see the route.
 */
export function safeInAppPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // A bounded length so a pathological string cannot be handed to the URL
  // parser. Real destinations in this app are well under 200 characters.
  if (value.length === 0 || value.length > 2048) return null;

  if (CONTROL_OR_SPACE.test(value)) return null;

  // Must be rooted, and must not be protocol-relative.
  if (!value.startsWith('/')) return null;
  if (value.startsWith('//')) return null;

  // Backslashes are not path separators here and browsers do not agree on
  // them; anything containing one is refused rather than normalised. This is
  // what closes "/\evil.example".
  if (value.includes('\\')) return null;

  try {
    const url = new URL(value, RESOLUTION_BASE);
    if (url.origin !== RESOLUTION_BASE) return null;
    // Rebuilt from the parsed parts rather than echoed back, so what the
    // caller navigates to is what the check actually inspected.
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}
