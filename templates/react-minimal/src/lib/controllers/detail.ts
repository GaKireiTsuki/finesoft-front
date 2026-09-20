import { BaseController } from "@finesoft/front";
import { markPublic } from "@finesoft/front/web";
import type { DetailPage } from "../models/page";
import type { DetailControllerInput as Input } from "../../../.finesoft/controller-types";

export class DetailController extends BaseController<Input, DetailPage> {
    execute({ params }: Input): DetailPage {
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
