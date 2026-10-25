# 问读浏览器插件实施计划

状态：Phase 3B AI 配置完成，等待 AI 训练调用与浏览器手工验收
版本：MVP-1
目标平台：Chrome / Edge，Manifest V3

## 1. 目标与验收结果

本项目是 `toulmin-reader` 的浏览器伴读插件，不替换原有 Web 应用。第一阶段必须完成一条可独立使用的链路：

1. 用户在网页上触发插件快捷键。
2. 插件在当前标签页提取标题、URL、作者和正文；优先使用用户选中的文本，其次使用 `article`、`main` 或正文区域。
3. 插件在扩展上下文保存一次待处理捕获记录。
4. 插件打开或聚焦扩展训练页面。
5. 训练页面把标题、URL、正文预填入阅读框，并允许用户编辑后确认保存。
6. 页面不可访问、正文过短或提取失败时，训练页显示可恢复的错误和手动粘贴入口。

第一阶段不自动调用 AI、不新增网络请求、不写入原 Web 应用数据库、不要求账号登录。

## 2. 已确认约束

- 代码仓库：`/Users/armewang/Downloads/toulmin-reader-extension`。
- 原 Web 应用：`/Users/armewang/Downloads/toulmin-reader`，保持独立，不直接改动。
- 技术栈：Vite、React、TypeScript、Chrome/Edge MV3。
- 扩展入口：Side Panel 用于最近捕获和启动阅读；完整训练内容在独立扩展标签页中打开。
- 数据边界：第一阶段只使用 `chrome.storage.local`；正文不放入 URL，不发往第三方服务。
- 快捷键：通过 Manifest `commands` 声明可配置默认键，用户可在浏览器扩展快捷键设置中修改。
- 权限最小化：`sidePanel`、`storage`、`activeTab`、`scripting`；快捷键使用 Manifest 顶层 `commands` 配置，不申请全站 `host_permissions`。
- 安全边界：仅响应用户快捷键或插件页面按钮触发的当前页捕获；不做后台抓取、不做遥测、不保存密钥。

## 3. 推荐架构

```text
当前网页
  │ 用户快捷键 / Side Panel 按钮
  ▼
MV3 Service Worker（background.ts）
  │ tabs.query + scripting.executeScript
  ▼
当前页面提取函数（标题 / URL / 选区 / 正文）
  │ captureId + chrome.storage.local
  ▼
训练页（training.html + React）
  │ 读取待处理捕获，编辑、确认、保存
  ▼
chrome.storage.local（pendingCapture / savedArticles）
```

边界规则：Service Worker 负责浏览器 API 和路由；提取函数只返回可序列化数据；React 页面不直接读取网页 DOM；原 Web 应用的 AI Worker 暂不接入。

## 4. 数据结构与接口

### 4.1 捕获记录

```ts
type CaptureRecord = {
  id: string
  title: string
  url: string
  author?: string
  text: string
  selectedText?: string
  capturedAt: string
  source: 'shortcut' | 'side-panel'
}
```

存储键：

- `pendingCapture`: `CaptureRecord | null`，供训练页读取的一次性待处理文章。
- `savedArticles`: `{ version: 1, items: SavedArticle[] }`，兼容第一阶段写入的旧数组格式。
- `trainingSessions`: `{ version: 1, items: TrainingSession[] }`，保存每篇文章的 8 轮离线回答和断点。
- `lastTrainingTabId`: `number | undefined`，用于尝试聚焦已有训练页；失效后删除并创建新页。

### 4.2 Service Worker 消息

- `capture-current-page`: 捕获当前活动标签页并返回 `{ captureId }` 或结构化错误。
- `open-training-page`: 打开/聚焦 `training.html`。
- `get-pending-capture`: 训练页读取待处理记录。
- `save-article`: 训练页保存用户确认后的文章。

消息必须返回 `{ ok: true, data }` 或 `{ ok: false, error: { code, message } }`，不吞掉异常。

### 4.3 提取规则

1. 若当前选区非空且长度至少 40 字符，使用选区作为正文，并保留页面标题和 URL。
2. 否则按 `article`、`main`、`[role="main"]`、`body` 顺序选择候选节点。
3. 删除 `script`、`style`、`noscript`、`nav`、`aside`、`footer`、`form`、`header` 和 `svg`。
4. 使用 `innerText`，压缩连续空白和空行，截断到 36,000 字符。
5. 正文少于 120 字符时返回 `ARTICLE_TOO_SHORT`，训练页提供手动粘贴入口。
6. 对受限页面、浏览器内部页面和 `executeScript` 失败返回 `PAGE_NOT_ACCESSIBLE`，不尝试绕过浏览器权限。

## 5. 分阶段执行计划

### Phase 1：捕获并预填训练页（本次执行）

独立交付标准：安装解压后的扩展后，快捷键能在普通文章页打开训练页并显示正文；失败时可手动粘贴；构建和静态检查通过。

文件改动：

- `PLAN.md`：保存本计划和执行勾选状态。
- `package.json`、`pnpm-lock.yaml`：增加 `@types/chrome`，保持已有脚本。
- `vite.config.ts`：增加 `training.html` 多页面入口和 Service Worker 构建入口，输出 `background.js`。
- `training.html`：新增完整训练页入口。
- `public/manifest.json`：补充命令、权限、Service Worker 和训练页入口。
- `src/background.ts`：实现命令监听、当前标签页捕获、存储和训练页聚焦。
- `src/types.ts`：集中定义捕获记录、存储状态和消息类型。
- `src/App.tsx`：按页面入口渲染 Side Panel 和训练页。
- `src/App.css`、`src/index.css`：替换脚手架样式，覆盖窄 Side Panel 和训练页。
- `src/main.tsx`：保持单一 React 启动入口，并按 pathname 区分页面模式。
- `scripts/check-extension.mjs`：校验 manifest、构建产物和关键入口文件。

执行顺序：

1. 先更新依赖、类型和构建入口。
2. 写入类型与 Service Worker，先让浏览器 API 边界可编译。
3. 实现训练页和 Side Panel，再删除 Vite 默认演示内容。
4. 更新 manifest，保证命令指向已构建的 Service Worker。
5. 执行安装、lint、TypeScript、build 和扩展静态校验。
6. 用 Chrome/Edge 的“加载已解压的扩展程序”进行手工验收；不把浏览器临时目录或个人数据提交到 Git。
7. 将 Phase 1 TODO 全部勾选后提交一个聚焦 commit。

### Phase 2：本地文章架与导出

独立交付标准：用户可以在 Side Panel 查看、搜索、删除和重新打开已保存文章；可以导出 Markdown、JSON 和 PDF 友好的打印页面。该阶段不依赖 AI。

文件和设计：

- 新增 `src/storage/articles.ts`，把 `savedArticles` 封装成版本化存储接口。
- 将 `savedArticles` 从单数组升级为 `{ version: 1, items: SavedArticle[] }`，读取时兼容空值和旧数组。
- 新增 `src/export/markdown.ts` 和 `src/export/json.ts`，纯函数生成下载内容。
- 新增 `print.html` 或训练页打印模式，避免在 Service Worker 中伪造 PDF。
- Side Panel 增加最近阅读、收藏和删除操作。

验收包含重复保存、空标题、超长正文、导出文件名清洗、删除后刷新恢复、旧数据读取和存储配额错误。

### Phase 3A：本地离线图尔敏训练（本次执行）

独立交付标准：不接 AI 时仍可完成 8 轮本地手动训练；刷新训练页后可以继续当前轮次；不会伪造 AI 分数。

文件和设计：

- 从原项目 `lib/coach.mjs` 提取 8 个课程步骤的静态教学文本，不复制 Next/Cloudflare 运行时。
- 新增 `TrainingSession` 版本化本地存储，按文章 ID 保存当前轮次、回答、开始时间和完成时间。
- 训练页提供独立阅读确认、逐轮回答、回答历史、进度和重新开始。
- 本阶段不发送网络请求，不配置 API key，不展示虚假评分。

验收包含离线训练、刷新恢复、重复提交限制、删除文章同时删除训练记录、八轮完成状态。

### Phase 3B：插件内 AI 配置与可选辅助

独立交付标准：用户在插件设置中选择 Provider、填写模型和 API key 后才启用 AI；未配置 AI 时插件仍完整支持离线训练；AI 失败不会影响本地训练记录。

- 由扩展项目维护 API URL、超时、错误码和请求版本，不把原 Web 应用的 `/api/train` 假设直接写死。
- Provider、模型、API key 在插件设置页配置；API key 只能由用户明确提供并保存在扩展本地存储，禁止写入 URL、日志和提交记录。
- 直连模型服务只使用 manifest 的 optional host permission；用户点击保存/测试时才请求对应服务域名权限。
- 原 Worker 的 CORS allowlist 作为未来自建代理/同步的可选能力，不是插件运行前提。
- 在本地训练完成后提供“请求 AI 反馈”入口，AI 返回失败时保留当前回答和本地进度。

### Phase 4：发布与兼容性

独立交付标准：Chrome/Edge 解压安装和商店提交包均可通过检查；权限、隐私、图标和版本号与实际行为一致。

- 增加 16/32/48/128 图标并在 manifest 中声明。
- 编写商店隐私披露和最小权限说明。
- 执行 Chrome/Edge 两套手工验收矩阵。
- Firefox 继续保持单独 ADR，不在本阶段隐式兼容。

## 6. Phase 1 TODO

- [x] 调用 plan 子代理请求生成项目计划。
- [x] 读取项目 `AGENTS.md`、`CONTEXT.md`、目标 ADR、Vite/TypeScript 配置。
- [x] 确认本阶段不接 AI、不新增外部网络请求、不改原 Web 应用。
- [x] 将本计划保存到项目根目录 `PLAN.md`。
- [x] 增加 `@types/chrome` 并更新锁文件。
- [x] 创建共享类型和 Service Worker 消息协议。
- [x] 实现快捷键捕获、选区优先和正文候选节点提取。
- [x] 实现 pendingCapture、savedArticles 和训练页标签聚焦。
- [x] 创建 `training.html` 多页面入口。
- [x] 将 Side Panel 改成可用的捕获入口和最近状态页。
- [x] 删除 Vite 默认演示 UI，完成窄面板与训练页样式。
- [x] 更新 MV3 manifest 和 Vite 构建输出。
- [x] 增加扩展静态检查脚本。
- [x] 运行 `node_modules/.bin/oxlint .`、`node_modules/.bin/tsc --noEmit`、`pnpm build` 和 `node scripts/check-extension.mjs`。
- [x] 检查构建产物不包含源码密钥、全站 host permission 或意外网络依赖。
- [ ] 完成 Chrome/Edge 手工验收：普通文章、选区、短页面、受限页面、重复快捷键、聚焦训练页。
- [x] 提交 Phase 1 commit：`251dea7 feat(extension): capture articles into training page`。

## 7. Phase 2 TODO

- [x] 新增 `src/storage/articles.ts`，集中处理版本化读写、旧数组迁移、保存、删除和收藏切换。
- [x] 将 `savedArticles` 升级为 `{ version: 1, items: SavedArticle[] }`，旧数据读取时自动补齐 `isFavorite: false`。
- [x] 将单次保存上限从 50 条扩展为 100 条，并保留重复 ID 更新语义。
- [x] 新增 `src/export/markdown.ts` 和 `src/export/json.ts` 纯函数。
- [x] Side Panel 增加标题、作者、URL 和正文搜索。
- [x] Side Panel 增加收藏切换、删除、Markdown、JSON 和 PDF 打印入口。
- [x] 训练页增加 Markdown、JSON 和打印/PDF 入口。
- [x] 新增 `print.html`，使用浏览器原生打印流程生成 PDF，不伪造 PDF 文件。
- [x] 更新 Service Worker 消息协议和打印页标签复用逻辑。
- [x] 更新扩展静态检查以验证 `print.html` 构建产物。
- [x] 运行 TypeScript、直接 oxlint、生产构建和扩展静态校验。
- [ ] 完成浏览器手工验收：迁移旧数组、搜索、收藏、删除、Markdown/JSON 下载和打印保存 PDF。
- [ ] 完成浏览器手工验收后提交 Phase 2 commit。

## 8. Phase 3A TODO

- [x] 从原项目课程逻辑提取 8 个静态训练步骤到 `src/training/lessons.ts`。
- [x] 新增 `TrainingSession` 类型和 `src/storage/training.ts` 版本化存储。
- [x] 增加读取、开始、提交、重置训练会话的 Service Worker 消息。
- [x] 保存文章时展示离线训练入口和独立阅读确认。
- [x] 实现逐轮回答、进度、回答历史、完成状态和重新开始。
- [x] 删除文章时同步删除训练会话。
- [x] 运行 TypeScript、直接 oxlint、生产构建和扩展静态校验。
- [ ] 完成浏览器手工验收：刷新恢复、重复提交、八轮完成、删除联动。
- [ ] 完成浏览器手工验收后提交 Phase 3A commit。

## 9. Phase 3B TODO

- [x] 原 Worker 增加 `EXTENSION_ORIGINS` 精确 allowlist；默认空值时保持同源安全边界。
- [x] 原 Worker 增加扩展来源的 OPTIONS 预检响应和白名单响应头。
- [x] 原 Worker 安全测试覆盖已配置扩展 Origin、未配置扩展 Origin 和 API key 不回显。
- [x] 在扩展中增加 Provider、model 和 API key 的本地设置界面。
- [x] 为常见 Provider 声明 optional host permission，并通过用户手势请求目标域名权限。
- [x] 在权限拒绝时保持离线训练可用，并显示明确状态。
- [x] 增加模型连接测试，不在日志或响应中回显 API key。
- [ ] 接入 `/api/train` 的 start/grade 请求、超时、错误和本地回答保留。
- [ ] 对 AI 返回的 question、feedback、引用和当前回答做结构化校验。
- [ ] 如果未来启用 Worker 代理，在原 Worker 部署环境配置 `EXTENSION_ORIGINS=chrome-extension://<固定扩展ID>`。

## 9. 验证矩阵

自动检查：

- `pnpm install`
- `pnpm lint`
- `node_modules/.bin/tsc --noEmit`
- `pnpm build`
- `node scripts/check-extension.mjs`
- 解析 `dist/manifest.json`，确认 `background.service_worker`、`side_panel.default_path`、`commands` 和权限与输出文件一致。

手工检查：

| 场景 | 预期 |
| --- | --- |
| 普通新闻或博客文章 | 快捷键打开训练页，标题、URL、正文正确预填 |
| 先选中一段正文 | 训练页优先显示选区，不抓取整页 |
| 连续触发两次 | 复用或聚焦训练页，不产生错误页面；最新捕获明确覆盖待处理记录 |
| 正文少于 120 字符 | 显示原因，并提供手动粘贴入口 |
| `chrome://` 或权限受限页 | 显示不可访问原因，不崩溃、不伪造成功 |
| 训练页修改标题和正文后保存 | 保存成功并可在 Side Panel 看到最近文章 |
| 刷新训练页 | 文章内容和状态不因为 React 刷新而丢失 |
| 未授权网络 | 插件仍可完成本地捕获和阅读，不产生外部请求 |

## 10. 风险、回滚与不做事项

- 页面结构差异：MVP 使用候选节点和手动粘贴兜底；不在第一阶段引入大型正文解析依赖。
- 浏览器权限限制：只接受 `activeTab` 和用户手势能访问的页面；失败直接提示，不请求全站权限。
- 存储配额：第一阶段限制正文长度并保存单条 pending 记录；Phase 2 再引入版本化存储和配额提示。
- Service Worker 生命周期：不依赖内存状态，捕获数据写入 `chrome.storage.local` 后再打开训练页。
- 用户隐私：不上传正文、不加遥测、不把全文放入 URL；后续远程 AI 必须单独设计并获得明确配置。
- 回滚：Phase 1 只新增扩展项目文件，不修改原 Web 应用；回滚只需恢复本项目上一个 commit，用户已保存的原 Web 应用数据不受影响。若用户已在浏览器加载旧构建，重新加载扩展即可回到上一个构建。

本计划不包含：自动 AI 总结、账号同步、跨设备同步、全站后台抓取、Firefox 适配、商店发布、复制 Glasp 的默认公开数据行为。

## 11. 失败处理与后续交接

实现过程中若当前脚手架与计划冲突，先在本文件“执行记录”中记录事实和替代方案，再修改计划后继续；不悄悄扩大权限或引入新服务。所有阶段完成后保留自动验证命令、手工验收结果和提交哈希。

## 12. 执行记录

- 2026-10-24：完成项目上下文、ADR、构建配置和已有扩展目标核对。
- 2026-10-24：已启动 planner 子代理请求生成本计划；因代理未在共享目录交付文件，主代理依据同一上下文补写本计划并继续执行。
- 2026-10-25：完成 Phase 1 MVP 实现；TypeScript、生产构建、直接 oxlint 和扩展静态检查通过。`pnpm lint` 受环境 ESLint JSON 解析包装器影响退出码为 1，直接 oxlint 结果为 0，仅保留一条 React effect 警告。
- 2026-10-25：浏览器手工加载尚未执行，原因是加载解压扩展会修改浏览器配置，需要用户明确确认后进行。
- 2026-10-25：完成 Phase 2 本地文章架与导出；版本化存储、迁移、搜索、收藏、删除、Markdown/JSON 下载和打印/PDF 友好页面已实现。TypeScript、直接 oxlint、生产构建和扩展静态检查通过。
- 2026-10-25：完成 Phase 3A 本地离线训练；复用了原项目 8 轮课程文本，但未复制 AI/Next/Cloudflare 运行时。TypeScript、直接 oxlint、生产构建和扩展静态检查通过。
- 2026-10-25：按用户要求将 AI 配置放入插件设置；完成 Provider、模型、API key、本地存储、optional host permission 请求和连接测试。Worker 仍不是插件运行前提，原项目 CORS 提交 `7be2abb` 保留为可选代理基础。
