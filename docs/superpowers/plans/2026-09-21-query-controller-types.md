# Query 与 Controller 类型引用调整

用户要求移除新增的内联 execute/fallback 工厂写法，使 query 与 params 共用声明、推导和读取机制，保留 query 可选值、默认值和重复键语义，并去掉 Controller 文件尾部的生成声明区块。

## 实施范围

1. 移除内联 execute/fallback 对象支持及其专用接口；保留既有 BaseController、perform 工厂和 handler。
2. 复用 schema map 推导；补齐多值 query 的修饰器和反向路由，避免导航丢失数组。
3. 路径与 query 分离为两个对象；同步导航、序列化、SSR 预取和资源标识，避免同名覆盖和跨 query 缓存复用。模板在 routes.query 声明搜索字段，Controller 直接读取已校验输入，不重复手写字段类型。
4. Controller 类型生成继续只在开发/构建期工作。用户最终选择单对象方法 execute({ params, query, context })，fallback 同一对象增加 error，由框架维护 type import 与注解；所有声明保留在 .finesoft 内，迁移旧尾部区块。

## 验收

- 独立 class、handler 与 perform 工厂仍可用；新增的内联 execute/fallback 写法不再被接受。
- params/query 的 number、optional、default、list 类型与运行时值一致；数组可导航、可读取，query 不再覆盖同名路径字段，缺省语义保留。
- 生成代码无尾部声明区块，无业务模块执行，无类型擦除为 any；格式化后重复生成不改写文件，路由编辑会更新 IDE 类型。
- 实施后执行 vp check、相关测试、全量测试和构建；验证真实模板项目与浏览器 query 流程。保留所有既有未提交工作，不提交或推送。
