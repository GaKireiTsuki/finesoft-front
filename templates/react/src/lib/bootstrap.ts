import { type Framework, defineRoutes, type RouteDefinition } from "@finesoft/front";
import { HomeController } from "./controllers/home-controller";

const routes: RouteDefinition[] = [
    { path: "/", intentId: "home-page", controller: new HomeController() },
];

export function bootstrap(framework: Framework): void {
    defineRoutes(framework, routes);
}

export { routes };
