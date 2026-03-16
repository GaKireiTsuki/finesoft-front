/**
 * URL 工具函数
 */

/** 移除 URL scheme (https://, http://) */
export function removeScheme(url: string): string {
	return url.replace(/^https?:\/\//, "");
}

/** 移除 URL host 部分，保留路径 */
export function removeHost(url: string): string {
	try {
		const parsed = new URL(url);
		return parsed.pathname + parsed.search + parsed.hash;
	} catch {
		return url;
	}
}

/** 移除 query 参数 */
export function removeQueryParams(url: string): string {
	return url.split("?")[0];
}

/** 获取 URL 的基础路径（无 query、hash） */
export function getBaseUrl(url: string): string {
	return url.split("?")[0].split("#")[0];
}

/** 构建 URL（路径 + query 参数） */
export function buildUrl(
	path: string,
	params?: Record<string, string | undefined>,
): string {
	if (!params) return path;

	const searchParams = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined) {
			searchParams.set(key, value);
		}
	}

	const qs = searchParams.toString();
	return qs ? `${path}?${qs}` : path;
}
