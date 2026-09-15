# Guarded page loading

URL, SSR and structured navigation use the same guarded page loader. Global, route and navigation guards run before and after page execution; every Split destination is checked.

## Guard / 守卫

```ts
import { next, redirect, type BeforeLoadGuard } from "@finesoft/front/web";
export const signedIn: BeforeLoadGuard = (context) =>
    context.getCookie("session")
        ? next()
        : redirect("/login?next=" + encodeURIComponent(context.url));
// app.beforeLoad: [signedIn], or home.route("/account", { beforeLoad: [signedIn] })
```

Guards return `next()`, `deny(status, message)`, `redirect(url, status)` or `rewrite(url)`. First non-next result stops that chain. A browser redirect continues through host admission; SSR emits an HTTP redirect. Operation policies are a separate portable layer: protect data operations there too, instead of relying only on page guards. A warm HTML cache must not bypass the current request’s checks.

<Ch03MiddlewarePlayground />
