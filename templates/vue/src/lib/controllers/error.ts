import type { ErrorPage } from "../models/product";

export function getErrorPage(status: number, message: string): ErrorPage {
    return {
        id: "error",
        pageType: "error",
        title: `Error ${status}`,
        description: message,
        status,
    };
}
