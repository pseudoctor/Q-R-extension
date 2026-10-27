# Privacy Policy

## Q&R｜AI Critical Reading Coach

Last updated: October 27, 2026

Q&R｜AI Critical Reading Coach is a local-first Chrome/Edge Manifest V3 extension. It does not require an account and does not provide a built-in cloud storage service.

## Data handled by the extension

The extension may handle the following data when you use the corresponding features:

- Article data: page title, URL, author or source metadata, selected text, article text, and paragraph structure.
- Reading and training data: predictions, questions, answers, drafts, training sessions, model feedback, reference answers, favorites, and export data.
- Settings: selected provider, model name, endpoint, language, and local feature preferences.
- API keys: an API key supplied by you when you configure an AI provider.

## Local storage

Article data, training records, settings, favorites, and preferences are stored in the browser's extension storage on your device. Q&R does not provide built-in cloud synchronization for this data.

API keys are stored in `chrome.storage.session` for the current browser session. They are not intentionally written to article records or ordinary persistent settings. A key may need to be entered again after the browser session ends.

You can delete saved articles from the extension, clear the configured API key in Settings, or remove the extension and clear its browser storage using the browser's extension controls.

## AI requests and third parties

AI features are optional. If AI is not enabled, Q&R does not send your articles or answers to a model service.

When you enable an AI feature and start a request, Q&R sends the article or answer context needed for that request to the provider endpoint you selected. The endpoint may be a supported provider or a custom endpoint that you entered. The request can include the API key supplied for that endpoint. Q&R does not route these requests through a project-operated server.

The selected provider may retain or process requests under its own privacy policy and terms. Review the provider's terms before sending sensitive content. Q&R does not control the provider's retention, logging, or processing practices.

Q&R does not sell your data and does not include advertising, telemetry, analytics, or tracking requests. Remote images found in articles are not fetched automatically by the extension.

## Permissions

- `activeTab` and `scripting`: used after your action to capture the current webpage or selected content.
- `sidePanel`: used to provide the extension's side-panel interface.
- `storage`: used for local article, training, preference, and session data.
- Optional host permissions: requested for the AI endpoint that you confirm in Settings. The extension does not request permanent access to every website at installation time.

The extension executes its bundled code and does not load or execute remote JavaScript.

## Changes and contact

If this policy changes, the updated version will be published in this repository. For privacy questions or requests, open an issue in the [Q&R repository](https://github.com/pseudoctor/Q-R-extension/issues).

## 隐私政策

### Q&R｜AI Critical Reading Coach

更新日期：2026 年 10 月 27 日

Q&R｜AI Critical Reading Coach 是一个以本地处理为主的 Chrome/Edge Manifest V3 扩展。不要求注册账号，也不提供项目自建的云端存储服务。

### 扩展处理的数据

使用对应功能时，扩展可能处理以下数据：

- 文章数据：网页标题、URL、作者或来源信息、选中文本、文章正文和段落结构。
- 阅读与训练数据：预读记录、问题、回答、草稿、训练 session、模型反馈、参考答案、收藏和导出数据。
- 设置数据：所选服务商、模型名称、endpoint、语言和本地功能偏好。
- API key：你配置 AI 服务时提供的 API key。

### 本地存储

文章、训练记录、设置、收藏和偏好保存在你设备上的浏览器扩展存储中。Q&R 不提供内置云同步。

API key 保存在当前浏览器会话的 `chrome.storage.session` 中，不会有意写入文章记录或普通持久化设置。浏览器会话结束后，可能需要重新输入 API key。

你可以在扩展中删除已保存文章、在设置页清除 API key，也可以通过浏览器的扩展管理功能移除扩展并清理其存储。

### AI 请求与第三方服务

AI 功能是可选的。未启用 AI 时，Q&R 不会把文章或回答发送给模型服务。

启用 AI 功能并发起请求后，Q&R 会把该请求所需的文章或回答上下文发送到你选择的服务商 endpoint。endpoint 可以是内置支持的服务商，也可以是你在设置页输入的自定义地址。请求可能包含你为该 endpoint 提供的 API key。Q&R 不会通过项目自建服务器转发这些请求。

所选服务商可能依据其自身的隐私政策和服务条款保存或处理请求。发送敏感内容前，请先阅读对应服务商的条款。Q&R 无法控制服务商的保存、日志记录或处理方式。

Q&R 不出售你的数据，也不包含广告、遥测、分析或跟踪请求。文章中的远程图片不会由扩展自动获取。

### 权限用途

- `activeTab` 和 `scripting`：在你主动操作后读取当前网页或选中的内容。
- `sidePanel`：提供扩展的侧边栏界面。
- `storage`：保存本地文章、训练、偏好和会话数据。
- 可选 host permission：用于你在设置页确认的 AI endpoint。扩展不会在安装时申请所有网站的永久读取权限。

扩展只执行随扩展包提供的代码，不加载或执行远程 JavaScript。

### 政策变更与联系

如果本政策发生变化，更新版本会发布在本仓库中。如有隐私问题或请求，请在 [Q&R 仓库](https://github.com/pseudoctor/Q-R-extension/issues) 提交 issue。
