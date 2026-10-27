# 问读｜AI 批判性阅读教练

问读是一个 Chrome/Edge Manifest V3 浏览器扩展：把正在阅读的文章带入训练页，帮助你完成阅读前预测、结构化批判性阅读和图尔敏论证分析，并把文章与训练记录保存在浏览器本地。

AI 是可选能力。没有 AI 配置时，仍可以保存文章、完成本地训练、编辑回答和导出记录；配置 AI 后，扩展才会向你选择的模型服务发送训练所需的文章内容和回答。

## 功能概览

- 从当前网页提取文章标题、元信息、正文和部分结构化内容；无法读取的页面可以手动粘贴。
- 在独立训练页完成十步引导式阅读流程：预读、快速浏览、段落分析、摘要、问题、假设和图尔敏论证等。
- 使用 AI 生成训练问题、评分反馈、追问和参考答案；每次 AI 返回的原文依据都会经过本地校验。
- 本地保存文章、训练历史、收藏和版本记录。
- 导出 Markdown、Obsidian、JSON，或打开打印页保存为 PDF。

完整训练流程见 [`docs/reading-training-10-step-workflow.md`](docs/reading-training-10-step-workflow.md)。

## 快速开始

### 安装开发版

```bash
pnpm install
pnpm build
```

在 Chrome 或 Edge 中打开扩展管理页，开启“开发者模式”，选择“加载已解压的扩展程序”，载入项目生成的 `dist/` 目录。

代码更新后重新运行 `pnpm build`，再在扩展管理页点击“重新加载”。

### 获取文章

打开普通网页中的文章，然后使用以下任一方式：

- Windows/Linux：`Ctrl+Shift+8`
- macOS：`Command+Shift+8`
- 打开扩展侧边栏，点击“获取当前文章”

扩展只在用户点击按钮或触发快捷键后读取当前页面。开始训练前，请检查标题、来源、元信息和正文，并确认段落结构是否需要调整。

### 无法自动读取时

浏览器内部页、扩展页、商店页和部分 PDF 不允许扩展读取。遇到这种情况，打开侧边栏中的“手动粘贴文章”，然后在训练页填写标题、来源和正文。

### 开始训练

在正文下方填写阅读前预测，只根据标题、来源和已有信息记录预计问题、主张或论证方向。确认文章内容后，点击“保存并开始训练”。

训练可以在没有 AI 的情况下继续进行。配置 AI 后，扩展会按照当前训练步骤生成问题、评分和反馈；回答保存后，还可以请求参考答案或字段提示。

## AI 配置

在侧边栏或设置页选择服务商，填写模型名称和 API key，必要时填写完整的 API endpoint，然后先测试连接再保存设置。

当前版本使用 OpenAI-compatible Chat Completions 接口。自定义服务地址必须是完整的 `/chat/completions` endpoint；HTTPS 服务可使用公开域名，HTTP 只允许本机 `localhost` 或 `127.0.0.1` 地址。

API key 只保存在当前浏览器会话的扩展 session storage 中，关闭浏览器后需要重新输入。不要在共享电脑上使用高权限密钥，也不要把 key 写进源码、URL、日志或提交记录。

保存设置或测试连接时，扩展会按用户确认的服务地址请求可选网络权限。拒绝权限时不会保存相关 AI 设置，也不会发送 AI 请求。

## 数据、权限与隐私

- 文章、训练记录、收藏和导出前的数据保存在浏览器本地 `chrome.storage.local` 中，不提供内置云同步。
- API key 使用 `chrome.storage.session`，不写入文章记录或普通设置持久化数据。
- 页面抓取使用 Manifest V3 的 `activeTab` 和 `scripting`，不在安装时申请所有网站的永久读取权限。
- AI 未启用时，文章和回答不会发送到第三方模型服务；启用后只发送到用户选择的服务商 endpoint。
- 扩展不包含遥测、广告或额外的分析网络请求。
- 文章中的远程图片在扩展预览、打印和 Markdown 导出中默认显示为占位文本，不会自动请求第三方图片。

## 导出与本地数据

训练记录可以导出为：

- Markdown
- Obsidian URI
- JSON
- 打印页或 PDF

为避免浏览器存储无限增长，文章、训练 session、版本、请求记录和归档数量都有上限。达到限制时，系统优先保留当前记录和收藏内容；超出单条记录限制的数据不会写入。

## 常见问题

### 快捷键没有反应

请确认当前标签页是普通网页，并检查浏览器的扩展快捷键设置是否与其他扩展冲突。也可以直接在侧边栏点击“获取当前文章”。

### 插件没有获取到正文

先刷新文章页面并重试。如果页面仍然不允许扩展读取，请使用“手动粘贴文章”。正文过短、页面使用特殊阅读器或内容位于浏览器内部页时，也可能需要手动粘贴。

### AI 连接失败

检查 endpoint、模型名称和 API key 是否匹配，并在设置页重新测试连接。服务商暂时无法返回模型列表时，可以按照服务商支持的模型名称手动填写。

### AI 原文引用校验失败

扩展要求模型返回的 quote 必须是文章来源块中的连续原文，并且 paragraph/blockId 必须对应当前训练步骤允许的范围。模型偶尔返回改写或不连续引用时，直接重试即可；如果持续失败，请检查模型 endpoint 是否确实支持结构化 JSON 输出。

## 开发

项目使用 Vite、React、TypeScript 和 Chrome/Edge Manifest V3。

启动开发服务器：

```bash
pnpm install
pnpm dev
```

类型检查、静态检查和生产构建：

```bash
pnpm exec tsc -b
pnpm exec oxlint .
pnpm build
```

运行扩展和回归检查：

```bash
pnpm check:extension
pnpm check:store-assets
pnpm check:release
pnpm check:article-format
pnpm check:pre-reading
pnpm check:training-flow
pnpm check:i18n
pnpm check:storage-concurrency
pnpm check:training-audit
pnpm check:ai-storage
pnpm check:message-security
pnpm check:ai-http
pnpm check:provider-settings
pnpm check:browser
```

`pnpm check:browser` 使用本地 Chrome 或 CI 安装的 Chrome 运行 headless smoke test；如果本机 Chrome 无法启动，脚本会明确跳过，不把跳过结果当作真实浏览器验收。

架构决策见 [`docs/adr/0001-chrome-mv3-side-panel.md`](docs/adr/0001-chrome-mv3-side-panel.md)。

## 打包发布

商店素材位于 `store-assets/`。其中 `*-source.png` 和 `drafts/` 只作为源文件保留，不会被打包进扩展。

```bash
pnpm check:store-assets
pnpm package:extension
```

`pnpm package:extension` 会构建扩展、检查 Manifest、版本同步、商店素材和发布文件白名单，然后生成：

```text
release/toulmin-reader-extension-v<version>.zip
```

真实 Chrome/Edge 交互和真实模型请求仍需在目标浏览器及已配置的 AI 服务中手工验收。本地模拟脚本不会被当作真实服务验收证据。

## Contributors

- [pseudoctor](https://github.com/pseudoctor) — 项目维护与产品决策
- Codex (OpenAI) — 实现协助、安全审查修复、测试和文档支持

## 支持项目

如果问读对你有帮助，欢迎自愿支持项目维护。打赏不提供付费服务、优先支持或技术支持承诺。

| 支付宝 | PayPal |
| --- | --- |
| ![支付宝打赏二维码](public/assets/donate-alipay.jpg) | ![PayPal 打赏二维码](public/assets/donate-paypal.jpg) |
