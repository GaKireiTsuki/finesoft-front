import { createActiveLeafCodec, type NavigationCodec } from "../navigation/codec";
import { leaf, stack } from "../navigation/nodes";
import { deserializeNavigation, serializeNavigation } from "../navigation/serialization";
import type { WebRuntime } from "./runtime";
import type { WebAppDefinition } from "./types";
/** Resolve and validate once, then let an application arrange typed targets. */
export async function resolveInitialNavigation(
    web: WebRuntime,
    url: string,
    options: {
        codec?: NavigationCodec;
        initial?: WebAppDefinition["navigation"];
    } = {},
) {
    const codec = options.codec ?? web.definition.navigationCodec ?? createActiveLeafCodec();
    const overlay = codec.decode(url, web.router);
    const match = await web.router.resolve(url);
    const target = match ? leaf(match.intent.id, match.intent.params, { url }) : undefined;
    const initial = options.initial ?? web.definition.navigation;
    const arranged =
        typeof initial === "function"
            ? initial({ url, match: match ?? undefined, target })
            : initial;
    const tree = overlay ?? arranged ?? (target && stack(target));
    if (!tree) return undefined;
    return {
        tree: deserializeNavigation(serializeNavigation(tree)),
        renderMode: match?.renderMode,
    };
}
