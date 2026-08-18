/**
 * Errors as values. Every failure this bot has — CTFtime down, a provider
 * rejecting a parameter, a model emitting prose — is a normal weekly event, not
 * an exceptional one, so it belongs in the type rather than in the stack.
 *
 * Hand-rolled rather than imported: the project ships zero runtime dependencies
 * and this is the only abstraction it needs. See ADR-0004.
 */

export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });

export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export const map = <T, U, E>(result: Result<T, E>, f: (value: T) => U): Result<U, E> =>
  result.ok ? ok(f(result.value)) : result;

export const mapError = <T, E, F>(result: Result<T, E>, f: (error: E) => F): Result<T, F> =>
  result.ok ? result : err(f(result.error));

export const flatMap = <T, U, E>(
  result: Result<T, E>,
  f: (value: T) => Result<U, E>,
): Result<U, E> => (result.ok ? f(result.value) : result);

export const unwrapOr = <T, E>(result: Result<T, E>, fallback: T): T =>
  result.ok ? result.value : fallback;

/** Adapts a throwing platform API (JSON.parse, WebCrypto) into a Result. */
export const attempt = <T, E>(f: () => T, onError: (cause: unknown) => E): Result<T, E> => {
  try {
    return ok(f());
  } catch (cause) {
    return err(onError(cause));
  }
};

/** Adapts a rejecting platform API (fetch) into a Result. */
export const attemptAsync = async <T, E>(
  f: () => Promise<T>,
  onError: (cause: unknown) => E,
): Promise<Result<T, E>> => {
  try {
    return ok(await f());
  } catch (cause) {
    return err(onError(cause));
  }
};
