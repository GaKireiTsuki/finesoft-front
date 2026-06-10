import { route } from "../../src/bootstrap/define-routes";
import { int, str } from "../../src/router/params";

// 合法：id 是 "/product/:id" 的参数
const ok = route("/product/:id", { intentId: "product", params: { id: int() } });

// 非法：slug 不是 "/product/:id" 的参数 → 编译期报错
// @ts-expect-error - "slug" is not a parameter of "/product/:id"
const bad = route("/product/:id", { intentId: "product", params: { slug: str() } });

void ok;
void bad;
