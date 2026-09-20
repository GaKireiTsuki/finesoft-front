# 可观测性

可移植结构化事件使用 runtime recorder。Web 日志配置放在 app.configuration，不为注册诊断再创建框架实例。ReportingLoggerFactory 可通过业务回调转发警告/错误。公开诊断不能带私有输入、凭据或任意上游错误。浏览器曝光观察使用浏览器入口。

```ts
import { ConsoleEventRecorder, createRuntime } from "@finesoft/front";
const runtime = createRuntime({ app, recorder: new ConsoleEventRecorder() });
// In an operation: context.record("checkout.completed", { itemCount: 2 });
// In defineWebApp: configuration: { eventRecorder: recorder, reportCallback }
```
