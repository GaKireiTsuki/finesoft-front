# 页面守卫

URL、SSR、结构化导航共用页面加载器；执行前后运行全局、路由和导航守卫，每个 Split 目标都要检查。

## Guard / 守卫

```ts
import { next, redirect, type BeforeLoadGuard } from "@finesoft/front";
export const signedIn: BeforeLoadGuard = (context) =>
    context.getCookie("session")
        ? next()
        : redirect("/login?next=" + encodeURIComponent(context.url));
// app.beforeLoad: [signedIn], or home.route("/account", { beforeLoad: [signedIn] })
```

守卫返回 `next()`、`deny(status, message)`、`redirect(url, status)` 或 `rewrite(url)`；首个非 next 结果终止当前链。浏览器重定向仍经过主机导航准入，SSR 则返回 HTTP 重定向。操作策略属于可移植运行时层，数据接口也需在那里授权。已缓存 HTML 不能绕过当前请求的检查。

<Ch03MiddlewarePlayground />
