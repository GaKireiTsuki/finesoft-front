import { createActiveLeafCodec, type NavigationCodec } from "../navigation/codec";
import { leaf, stack } from "../navigation/nodes";
import { deserializeNavigation, serializeNavigation } from "../navigation/serialization";
import type { Framework } from "../framework";
import type { NavigationNode } from "../navigation/types";
/** Every caller gets a validated detached tree. Hydration identities take precedence at the host. */
export async function resolveInitialNavigation(
    framework: Framework,
    url: string,
    options: {
        codec?: NavigationCodec;
        initial?: NavigationNode | ((url: string) => NavigationNode | undefined);
    } = {},
) {
    const codec = options.codec ?? createActiveLeafCodec();
    const initial = options.initial;
    const tree =
        codec.decode(url, framework.router) ??
        (typeof initial === "function" ? initial(url) : initial);
    if (tree)
        return { tree: deserializeNavigation(serializeNavigation(tree)), renderMode: undefined };
    const match = await framework.routeUrl(url);
    if (!match) return undefined;
    return {
        tree: stack(leaf(match.intent.id, match.intent.params, { url })),
        renderMode: match.renderMode,
    };
}
