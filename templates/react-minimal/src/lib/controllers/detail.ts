import { BaseServerController } from "@finesoft/front";
import { markPublic } from "@finesoft/front";
import type { DetailPage } from "../models/page";
import type { DetailControllerInput as Input } from "../../../.finesoft/controller-types";

export class DetailController extends BaseServerController<Input, DetailPage> {
    execute({ params, context }: Input): DetailPage {
        const id = params.id ?? "?";
        // GET during SSR, POST when browser navigation loads this controller remotely.
        context.responseHeaders.set("x-demo-request-method", context.request.method);
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
