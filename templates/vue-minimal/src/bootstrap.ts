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
 *
 * `initial` 用 **URL→树 工厂**（而非静态树）：这样深链 / 刷新 `/item/2` 能重建出
 * 「Home 栈压着 detail」的结构，active-leaf codec 也把它回写成 `/item/2`，刷新不再跳回 `/`。
 * （静态树会忽略 URL、永远从 home 起，刷新被改回 `/`。）
 */
export const navigation = defineNavigation({
    initial: (url) => {
        const path = url.split("?")[0].split("#")[0];
        const detail = /^\/item\/(.+)$/.exec(path);
        const home = detail
            ? stack([leaf("home"), leaf("detail", { id: detail[1] })])
            : stack(leaf("home"));
        return tabs({
            active: path === "/notes" ? "notes" : "home",
            branches: { home, notes: stack(leaf("notes")) },
        });
    },
});
