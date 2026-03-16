import type { BasePage } from "@finesoft/front";

export function getErrorPage(status: number, message: string): BasePage {
    return {
        id: "error",
        pageType: "error",
        title: `Error ${status}`,
        description: message,
    };
}
