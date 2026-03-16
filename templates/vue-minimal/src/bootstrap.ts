import { type Framework, defineRoutes } from "@finesoft/front";
import { HomeController } from "./lib/controllers/home";

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [{ path: "/", intentId: "home", controller: new HomeController() }]);
}
