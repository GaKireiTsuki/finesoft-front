/**
 * Router 共享类型
 *
 * `RouteParams` 是路由参数（path + query 经 codec 转换后）的统一形状，
 * 同时也是 Intent.params、NavigationContext.params 与 LeafNode.params 的共同类型。
 */

/** 路由参数：键为参数名，值为 codec 转换后的任意类型（string / number / boolean …）。 */
export type RouteParams = Record<string, unknown>;
