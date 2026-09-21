/**
 * A permission refusal the error boundary can recognise.
 *
 * In production Next strips a server error's message before it reaches the
 * browser, leaving only its `digest`. So a role check that failed while a page
 * rendered arrived at app/dashboard/error.jsx looking exactly like a crash —
 * "Oops! Something went wrong… our team has been notified" — for someone who
 * had simply opened a module their role does not include. Retrying cannot fix
 * that, and nobody was notified.
 *
 * Next keeps a digest the error already carries (create-error-handler.js:
 * "If the error already has a digest, respect the original digest"), so a
 * fixed digest is a marker that survives the trip without exposing anything.
 *
 * The message is unchanged: action modules match on it to surface it.
 */
export const ACCESS_DENIED_DIGEST = "ACCESS_DENIED";

export function accessDeniedError(
  message = "You don't have permission to perform this action.",
) {
  const err = new Error(message);
  err.digest = ACCESS_DENIED_DIGEST;
  return err;
}

export function isAccessDenied(error) {
  return error?.digest === ACCESS_DENIED_DIGEST;
}
