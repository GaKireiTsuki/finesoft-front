import type { BasePage } from "@finesoft/front/web";

export interface FeedItem {
    readonly id: string;
    readonly title: string;
}

export interface HomePage extends BasePage {
    readonly pageType: "home";
    readonly items: readonly FeedItem[];
}

export interface DetailPage extends BasePage {
    readonly pageType: "detail";
    readonly itemId: string;
}

export interface NotesPage extends BasePage {
    readonly pageType: "notes";
}

export interface ErrorPage extends BasePage {
    readonly pageType: "error";
    readonly status: number;
}

export type AppPage = HomePage | DetailPage | NotesPage | ErrorPage;
