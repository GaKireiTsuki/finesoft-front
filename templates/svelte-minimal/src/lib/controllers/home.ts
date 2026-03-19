import {
    BaseController,
    DEP_KEYS,
    type BasePage,
    type Container,
    type Translator,
} from "@finesoft/front";

export class HomeController extends BaseController<Record<string, string>, BasePage> {
    readonly intentId = "home";

    execute(_params: Record<string, string>, container: Container): BasePage {
        const translator = container.has(DEP_KEYS.TRANSLATOR)
            ? container.resolve<Translator>(DEP_KEYS.TRANSLATOR)
            : undefined;

        return {
            id: "home",
            pageType: "home",
            url: "/",
            title: translator?.t("home.title") ?? "Hello from Finesoft Front",
            description:
                translator?.t("home.description") ??
                "This page uses locale JSON files loaded by finesoftFrontViteConfig.",
        };
    }
}
