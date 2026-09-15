# 语言包体积

静态导入所有语言会增加浏览器包体积。在应用声明中使用生成的语言 loader。

## Loader / 加载器

```ts
import { loadMessages } from "virtual:finesoft-front/i18n-loader";
// defineWebApp({ ..., loadMessages })
```

使用相同路由、构建设置检查生产分块及 gzip 总量。入口变小可能只是字节移到别的分块。水合前 SSR 与客户端语言需一致。
