import { BaseController, type BasePage, HostGuardError, HttpClient } from "@finesoft/front";

class GenericHttpClient extends HttpClient {
    fetchRoot(): Promise<unknown> {
        return this.get("/");
    }
}

interface ImageProxyParams extends Record<string, string | undefined> {
    url?: string;
}

interface ImageProxyPage extends BasePage {
    proxyResult?: unknown;
}

export class ImageProxyController extends BaseController<ImageProxyParams, ImageProxyPage> {
    readonly intentId = "image-proxy";

    async execute(params: ImageProxyParams): Promise<ImageProxyPage> {
        if (!params.url) {
            return {
                id: "image-proxy",
                pageType: "image-proxy",
                title: "Image Proxy",
                description: "Pass ?url=<remote-image> to proxy a remote resource.",
            };
        }

        // HttpClient defaults to SSRF defense (allowInternalHosts: false). Passing
        // a loopback / private / reserved host or a non-http(s) scheme makes the
        // request throw HostGuardError before any network call.
        const client = new GenericHttpClient({ baseUrl: params.url });
        let proxyResult: unknown;
        try {
            proxyResult = await client.fetchRoot();
        } catch (err) {
            if (err instanceof HostGuardError) {
                proxyResult = { error: err.message };
            } else {
                proxyResult = { error: err instanceof Error ? err.message : String(err) };
            }
        }

        return {
            id: "image-proxy",
            pageType: "image-proxy",
            title: "Image Proxy",
            description: `Fetched: ${JSON.stringify(proxyResult)}`,
            proxyResult,
        };
    }
}
