import { BaseController, type BasePage } from "@finesoft/front";

/** 一个 feed 项。 */
export interface FeedItem {
    readonly id: string;
    readonly title: string;
}

/** Home（feed）页面：携带可 push 进 detail 的列表项。 */
export interface FeedPage extends BasePage {
    readonly items: readonly FeedItem[];
}

const ITEMS: readonly FeedItem[] = [
    { id: "1", title: "Structured navigation" },
    { id: "2", title: "Session restoration" },
    { id: "3", title: "Navigation-scoped state" },
];

export class HomeController extends BaseController<Record<string, string>, FeedPage> {
    readonly intentId = "home";

    execute(): FeedPage {
        return {
            id: "home",
            pageType: "home",
            url: "/",
            title: "Feed",
            description: "Tap an item to push a detail screen.",
            items: ITEMS,
        };
    }
}
