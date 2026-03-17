import { BaseController, type BasePage } from "@finesoft/front";

export class HomeController extends BaseController<Record<string, string>, BasePage> {
    readonly intentId = "home";

    execute(): BasePage {
        return {
            id: "home",
            pageType: "home",
            url: "/",
            title: "Home",
            description: "Welcome to Finesoft Front",
        };
    }
}
