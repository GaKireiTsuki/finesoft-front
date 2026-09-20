import { BaseController } from "@finesoft/front";
import { markPublic } from "@finesoft/front/web";
import type { FeedItem, HomePage } from "../models/page";

const ITEMS: readonly FeedItem[] = [
    { id: "1", title: "Structured navigation" },
    { id: "2", title: "Session restoration" },
    { id: "3", title: "Navigation-scoped state" },
];

export class HomeController extends BaseController<Record<string, string>, HomePage> {
    execute(): HomePage {
        return markPublic(
            {
                id: "home",
                pageType: "home",
                url: "/",
                title: "Feed",
                description: "Tap an item to push a detail screen.",
                items: ITEMS,
            },
            { items: { id: true, title: true } },
        );
    }
}
