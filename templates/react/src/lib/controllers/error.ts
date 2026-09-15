import { markPublic } from "@finesoft/front/web";
import type { ErrorPage } from "../models/product";

export function getErrorPage(status: number, message: string): ErrorPage {
    return markPublic(
        {
            id: "error",
            pageType: "error",
            title: `Error ${status}`,
            description: message,
            status,
        },
        ["status"],
    );
}
