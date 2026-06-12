import { BaseController, type BasePage } from "@finesoft/front";

/** Notes 页面：第二个 tab，演示切 tab 保活该分支的作用域状态。 */
export class NotesController extends BaseController<Record<string, string>, BasePage> {
    readonly intentId = "notes";

    execute(): BasePage {
        return {
            id: "notes",
            pageType: "notes",
            url: "/notes",
            title: "Notes",
            description: "This textarea is navigation-scoped — switch tabs and it survives.",
        };
    }
}
