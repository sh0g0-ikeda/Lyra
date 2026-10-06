const MAX_CURSOR_LENGTH = 1_024;
const MAX_CURSOR_KIND_LENGTH = 64;
const MAX_CURSOR_SORT_LENGTH = 128;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/u;
const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const isValidKind = (value) => value.length > 0 && value.length <= MAX_CURSOR_KIND_LENGTH;
const isValidSort = (value) => (typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_CURSOR_SORT_LENGTH) ||
    (typeof value === 'number' && Number.isFinite(value));
const isEncodedListCursor = (value, expectedKind) => {
    if (!isRecord(value)) {
        return false;
    }
    const keys = Object.keys(value).sort();
    if (keys.join(',') !== 'id,k,sort,v') {
        return false;
    }
    return (value.v === 1 &&
        value.k === expectedKind &&
        isValidSort(value.sort) &&
        typeof value.id === 'string' &&
        UUID_PATTERN.test(value.id));
};
export const encodeListCursor = (kind, sort, id) => {
    if (!isValidKind(kind) || !isValidSort(sort) || !UUID_PATTERN.test(id)) {
        throw new RangeError('Invalid list cursor components');
    }
    const value = { v: 1, k: kind, sort, id };
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
};
export const decodeListCursor = (cursor, expectedKind) => {
    if (cursor.length === 0 ||
        cursor.length > MAX_CURSOR_LENGTH ||
        !BASE64URL_PATTERN.test(cursor) ||
        !isValidKind(expectedKind)) {
        return null;
    }
    try {
        const decoded = Buffer.from(cursor, 'base64url');
        if (decoded.toString('base64url') !== cursor) {
            return null;
        }
        const value = JSON.parse(decoded.toString('utf8'));
        if (!isEncodedListCursor(value, expectedKind)) {
            return null;
        }
        return { sort: value.sort, id: value.id };
    }
    catch {
        return null;
    }
};
export const normalizeListPageLimit = (limit) => {
    if (limit === undefined ||
        !Number.isInteger(limit) ||
        limit < 1 ||
        limit > 100) {
        return null;
    }
    return limit;
};
