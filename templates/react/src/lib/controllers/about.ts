import { BaseController, type ControllerInput } from "@finesoft/front";
import { markPublic } from "@finesoft/front";
import type { AboutPage } from "../models/product";

export class AboutController extends BaseController<
    ControllerInput<Record<string, string>>,
    AboutPage
> {
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
