/**
 * Errors.
 *
 * Puter answers an API failure with `{ ok:false, error, code, status }` and a
 * matching HTTP status, so a client can tell "there is no such file" from "you
 * may not read that file" from "the server is broken". Every refusal in the
 * server raises one of these and the controller turns it into that shape; a
 * thrown non-ApiError is a bug, is logged, and answers 500.
 */

export class ApiError extends Error {
    constructor (status, code, message, extra = {}) {
        super(message || code);
        this.name = 'ApiError';
        this.status = status;
        this.code = code;
        this.extra = extra;
    }
    toJSON () {
        return { ok: false, error: this.message, code: this.code, ...this.extra };
    }
}

export const badRequest = (code, message, extra) =>
    new ApiError(400, code, message, extra);
export const unauthorized = (code = 'unauthorized', message = 'Sign in first.') =>
    new ApiError(401, code, message);
export const forbidden = (code = 'forbidden', message = 'That is not allowed.') =>
    new ApiError(403, code, message);
export const notFound = (code = 'not_found', message = 'No such file or directory.') =>
    new ApiError(404, code, message);
export const exists = (code = 'already_exists', message = 'That already exists.') =>
    new ApiError(409, code, message);
export const conflict = (code = 'conflict', message = 'That is out of date.', extra) =>
    new ApiError(409, code, message, extra);
export const tooLarge = (code = 'too_large', message = 'That is too big.') =>
    new ApiError(413, code, message);
export const quota = (code = 'quota_exceeded', message = 'Out of space.') =>
    new ApiError(507, code, message);
export const unavailable = (code = 'unavailable', message = 'Not available.') =>
    new ApiError(503, code, message);
export const airgapped = (target) =>
    new ApiError(403, 'airgapped',
        `The server is air-gapped: ${target} is not on the local network.`,
        { target });

/** True for anything raised on purpose, so the handler knows to answer with it. */
export const isApiError = (e) => e instanceof ApiError;
