import type { BasePage } from "@finesoft/front";

export interface HomePage extends BasePage {
    pageType: "home";
    body: string;
}

export interface ErrorPage extends BasePage {
    pageType: "error";
    errorMessage: string;
    statusCode: number;
}

export type Page = HomePage | ErrorPage;
