import { BaseController, type ControllerInput } from "@finesoft/front";
import type { BasePage } from "@finesoft/front";

export class HomeController extends BaseController<
    ControllerInput<Record<string, string>>,
    BasePage
> {
    execute(): BasePage {
        return {
            id: "home",
            pageType: "home",
            title: "Finesoft Adversarial Target",
            description: "A deliberately under-engineered app for security drills.",
        };
    }
}
