import { BaseController } from "@finesoft/front";
import { markPublic } from "@finesoft/front/web";
import type { AboutPage } from "../models/product";

export class AboutController extends BaseController<Record<string, string>, AboutPage> {
    readonly intentId = "about";

    execute(): AboutPage {
        return markPublic(
            {
                id: "about",
                pageType: "about",
                title: "About",
                description: "About Finesoft Front",
                url: "/about",
                content:
                    "Finesoft Front is a full-stack TypeScript framework with router, DI, middleware, SSR, and multi-platform deployment.",
            },
            ["content"],
        );
    }
}
