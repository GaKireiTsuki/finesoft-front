/**
 * Accept-Language 解析
 */

export function parseAcceptLanguage(
	header: string | undefined,
	supported?: string[],
	fallback?: string,
): string {
	const effectiveSupported = supported ?? ["zh", "en"];
	const effectiveFallback = fallback ?? effectiveSupported[0] ?? "en";
	if (!header) return effectiveFallback;
	const langs = header
		.split(",")
		.map((part) => {
			const [lang, q] = part.trim().split(";q=");
			return {
				lang: lang.trim().toLowerCase(),
				q: q ? parseFloat(q) || 0 : 1,
			};
		})
		.sort((a, b) => b.q - a.q);

	for (const { lang } of langs) {
		const prefix = lang.split("-")[0];
		if (effectiveSupported.includes(prefix)) {
			return prefix;
		}
	}
	return effectiveFallback;
}
