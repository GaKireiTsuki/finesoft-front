# 事件记录

可移植操作通过执行上下文发送结构化事件，runtime 接收 recorder。

## Recorder / 记录器

```ts
import { ConsoleEventRecorder, createRuntime } from "@finesoft/front";
const runtime = createRuntime({ app, recorder: new ConsoleEventRecorder() });
// In a handler: context.record("cart.updated", { itemCount: 3 });
```

记录业务结果时不要复制凭据、请求原文或私有页面数据。记录器故障与执行隔离。浏览器曝光使用显式浏览器 observer，可移植 core 只定义事件契约。
