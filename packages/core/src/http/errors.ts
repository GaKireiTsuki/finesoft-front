/** HTTP 请求错误 */
export class HttpError extends Error {
    constructor(
        public readonly status: number,
        public readonly statusText: string,
        public readonly body?: string,
    ) {
        super(`HTTP ${status}: ${statusText}`);
        this.name = "HttpError";
    }
}

/**
 * SSRF 防护拦截到不安全的目标地址时抛出。应用层可以 catch 它来给出业务友好的错误，
 * 不需要靠 message 字符串匹配。
 */
export class HostGuardError extends Error {
    constructor(
        public readonly url: string,
        public readonly reason: string,
    ) {
        super(`Refused to fetch ${url}: ${reason}`);
        this.name = "HostGuardError";
    }
}
