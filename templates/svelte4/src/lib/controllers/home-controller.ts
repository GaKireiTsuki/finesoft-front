import { BaseController, type Container } from "@finesoft/front";
import type { ErrorPage, HomePage, Page } from "../models/page";

export class HomeController extends BaseController<Record<string, string>, Page> {
    readonly intentId = "home-page";

    async execute(_params: Record<string, string>, _container: Container): Promise<HomePage> {
        return {
            id: "page-home",
            pageType: "home",
            title: "Hello Finesoft Front",
            description: "A minimal SSR page",
            body: "This page is rendered on the server first and hydrated on the client.",
        };
    }

    override fallback(_params: Record<string, string>, error: Error): ErrorPage {
        return {
            id: "page-error",
            pageType: "error",
            title: "Error",
            errorMessage: error.message,
            statusCode: 500,
        };
    }
}
