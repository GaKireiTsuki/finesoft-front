import { BaseController } from "@finesoft/front";
import type { BasePage } from "@finesoft/front/web";

export class HomeController extends BaseController<Record<string, string>, BasePage> {
    execute(): BasePage {
        return {
            id: "home",
            pageType: "home",
            title: "Finesoft Adversarial Target",
            description: "A deliberately under-engineered app for security drills.",
        };
    }
}
