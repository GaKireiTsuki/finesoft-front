export function parseCookieString(str: string): Map<string, string> {
    const map = new Map<string, string>();
    if (!str) return map;
    for (const pair of str.split(";")) {
        const idx = pair.indexOf("=");
        if (idx === -1) continue;
        const key = pair.slice(0, idx).trim();
        const val = pair.slice(idx + 1).trim();
        if (key) map.set(key, val);
    }
    return map;
}
