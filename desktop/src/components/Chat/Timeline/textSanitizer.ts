const UUID_TOKEN_PATTERN = '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const UUID_IN_PARENS_REGEX = new RegExp(`\\s*[（(]\\s*${UUID_TOKEN_PATTERN}\\s*[)）]`, 'g');
const UUID_REGEX = new RegExp(`\\b${UUID_TOKEN_PATTERN}\\b`, 'g');

export function sanitizeNoiseText(value: string): string {
    return value
        .replace(UUID_IN_PARENS_REGEX, '')
        .replace(UUID_REGEX, '')
        .trim();
}

export function sanitizeDisplayText(value: string): string {
    const normalized = sanitizeNoiseText(value)
        .replace(/\s+/g, ' ')
        .trim();
    return normalized || value.trim();
}
