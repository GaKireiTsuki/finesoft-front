/** Session adapter for the one, structural navigation snapshot format. */

import { deserializeNavigation, serializeNavigation } from "../navigation/index";
import type { NavigationController } from "../navigation/index";
import { collectLeafKeys } from "./scoped-state";
import { SessionError } from "./types";
import type { SessionNavigationAdapter, SessionSnapshot } from "./types";

/**
 * Captures and restores the full navigation tree for every page shape.
 * `currentUrl` is only a restore gate; navigation itself is never URL-only.
 */
export function createNavigationSessionAdapter(
    controller: NavigationController,
    currentUrl?: () => string,
): SessionNavigationAdapter {
    return {
        capture(): SessionSnapshot["navigation"] {
            return serializeNavigation(controller.getTree());
        },
        apply(navigation: SessionSnapshot["navigation"]): void | Promise<void> {
            if (navigation === undefined) return undefined;
            return controller.hydrate(deserializeNavigation(navigation)).then((candidate) => {
                if (controller.getSnapshot() !== candidate)
                    throw new SessionError("navigation-uncommitted");
            });
        },
        captureUrl(): string | undefined {
            return currentUrl?.();
        },
        presentKeys(): Iterable<string> {
            return collectLeafKeys(controller.getTree());
        },
    };
}
