import { BaseController } from "@finesoft/front";
import { markPublic } from "@finesoft/front/web";
import type { DetailPage } from "../models/page";

export class DetailController extends BaseController<{ id?: string }, DetailPage> {
    readonly intentId = "detail";

    execute(params: { id?: string }): DetailPage {
        const id = params.id ?? "?";
        return markPublic(
            {
                id: `detail-${id}`,
                pageType: "detail",
                url: `/item/${id}`,
                title: `Item ${id}`,
                description: "A pushed detail screen. Its scoped note is lost once you pop it.",
                itemId: id,
            },
            ["itemId"],
        );
    }
}
