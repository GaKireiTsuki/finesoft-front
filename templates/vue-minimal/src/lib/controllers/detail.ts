import { BaseController, type BasePage } from "@finesoft/front";

/** Detail 页面：由 push("detail", { id }) 进入；id 进 params。 */
export interface DetailPage extends BasePage {
    readonly itemId: string;
}

export class DetailController extends BaseController<{ id?: string }, DetailPage> {
    readonly intentId = "detail";

    execute(params: { id?: string }): DetailPage {
        const id = params.id ?? "?";
        return {
            id: `detail-${id}`,
            pageType: "detail",
            url: `/item/${id}`,
            title: `Item ${id}`,
            description: "A pushed detail screen. Its scoped note is lost once you pop it.",
            itemId: id,
        };
    }
}
