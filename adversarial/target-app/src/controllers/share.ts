import {
    BaseController,
    type BasePage,
    type Container,
    DEP_KEYS,
    HostGuardError,
} from "@finesoft/front";

interface ShareParams extends Record<string, string | undefined> {
    next?: string;
}

interface SharePage extends BasePage {
    preview?: string;
}

export class ShareController extends BaseController<ShareParams, SharePage> {
    readonly intentId = "share";

    async execute(params: ShareParams, container: Container): Promise<SharePage> {
        const target = params.next ?? "https://example.com";

        // SAFE_FETCH wraps DEP_KEYS.FETCH with SSRF defense (refuses loopback /
        // private / reserved hosts, including IPv4-mapped IPv6 and DNS-resolves
        // arbitrary hostnames). To opt out, container.resolve(DEP_KEYS.FETCH).
        const fetchFn = container.resolve<typeof globalThis.fetch>(DEP_KEYS.SAFE_FETCH);
        let preview = "(no preview)";
        try {
            const response = await fetchFn(target);
            preview = await response.text();
        } catch (err) {
            if (err instanceof HostGuardError) {
                preview = `refused: ${err.message}`;
            } else {
                preview = `fetch failed: ${(err as Error).message}`;
            }
        }

        return {
            id: "share",
            pageType: "share",
            title: "Share preview",
            description: `Preview of ${target}:\n\n${preview}`,
            preview,
        };
    }
}
