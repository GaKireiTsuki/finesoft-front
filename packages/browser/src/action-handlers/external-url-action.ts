/**
 * ExternalUrl Action Handler — 外部链接处理器
 */

import type { ExternalUrlAction, Framework, Logger } from "@finesoft/core";
import { ACTION_KINDS } from "@finesoft/core";

export interface ExternalUrlDependencies {
	framework: Framework;
	log: Logger;
}

export function registerExternalUrlHandler(
	deps: ExternalUrlDependencies,
): void {
	const { framework, log } = deps;

	framework.onAction(
		ACTION_KINDS.EXTERNAL_URL,
		(action: ExternalUrlAction) => {
			log.debug(`ExternalUrlAction → ${action.url}`);
			window.open(action.url, "_blank", "noopener,noreferrer");
		},
	);
}
