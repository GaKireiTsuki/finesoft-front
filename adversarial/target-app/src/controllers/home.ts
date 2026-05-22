import { BaseController, type BasePage } from "@finesoft/front";

export class HomeController extends BaseController<Record<string, string>, BasePage> {
    readonly intentId = "home";

    execute(): BasePage {
        return {
            id: "home",
            pageType: "home",
            title: "Finesoft Adversarial Target",
            description: "A deliberately under-engineered app for security drills.",
        };
    }
}
