import { Framework, defineNavigation, defineRoutes, leaf, stack, tabs } from "@finesoft/front";
import { DetailController } from "./lib/controllers/detail";
import { HomeController } from "./lib/controllers/home";
import { NotesController } from "./lib/controllers/notes";

/**
 * 同一份 bootstrap 在浏览器与服务器都会执行：注册 controllers + 路由。
 * 路由让 URL 能 resolve（SSR 首屏 / codec / 扁平回退都需要）。
 */
export function bootstrap(framework: Framework): void {
    defineRoutes(framework, [
        { path: "/", intentId: "home", controller: new HomeController() },
        { path: "/item/:id", intentId: "detail", controller: new DetailController() },
        { path: "/notes", intentId: "notes", controller: new NotesController() },
    ]);
}

/**
 * 结构化导航：一个 TabView（Home / Notes），每个 tab 是一个 NavigationStack。
 * - Home 栈可 push 到 detail（栈深 +1），返回 pop（栈深 -1）。
 * - 切 tab 保活另一分支的栈深与作用域状态（对标 SwiftUI TabView）。
 * 单 `leaf` 树即为今天的扁平单页 —— 这里用 tabs-of-stacks 展示完整结构化导航。
 */
export const navigation = defineNavigation({
    initial: tabs({
        active: "home",
        branches: {
            home: stack(leaf("home")),
            notes: stack(leaf("notes")),
        },
    }),
});
