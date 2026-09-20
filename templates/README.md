# 模板源码维护

六个目录仍是可运行的完整原生应用。每个级别的中立源码只维护一份：full 在 `react/src`，minimal 在 `react-minimal/src`。这些共用文件只使用公开的 portable/web 入口，不依赖 React；具体范围由 `scripts/sync-template-sources.mjs` 的 `shared` 清单定义。各目录继续独立维护原生组件、main/SSR 入口、视图注册和应用身份。

`vp install` 自动生成 Vue/Svelte 的中立源码。仓库内 `vp run dev` 和 `vp run build` 启动前会同步对应模板，直接调用内置 `vp dev` / `vp build` 前须在根目录运行 `vp run templates:sync`。同时开发多个模板时，可在根目录运行 `vp run templates:sync --watch`，公共源的修改会传到各模板并触发原生 HMR。

生成文件由根 `.gitignore` 忽略。修改中立业务时编辑上述唯一源；如果误改了副本，同步会报出文件和对应源的位置，先保留并移回源文件再同步。同步器只清理自己上次生成且未修改的旧文件，不覆盖本地修改。

脚手架发布准备先同步，再复制完整项目并移除仓库内部同步钩子。用户生成的项目包含普通源文件，没有生成器、兄弟目录或私有包依赖，可以直接编辑所有文件。
