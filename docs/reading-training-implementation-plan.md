🥷 # 十步阅读训练重组实施计划

## 1. 计划范围与结论

本计划针对当前浏览器扩展工作树，把现有八轮训练重组为 `docs/reading-training-10-step-workflow.md` 定义的十步阅读训练。目标是让十步顺序、题目、评分提示、会话存储、回退、导出和界面状态使用同一份步骤契约；Chrome/Edge MV3、Side Panel、扩展训练页和现有文章抓取边界保持不变。

推荐采用“新十步会话写入新存储键、旧八轮会话只读兼容”的双键方案，而不是原地把旧 `stepIndex` 重新解释为十步。旧八轮记录的语义与新十步并不一一对应，原地迁移会把旧的“隐藏假设与漏洞”错误拆成两个新步骤，也会使旧版本无法安全回滚。

本次规划依据的是当前工作树，而不是 HEAD：工作树已有多项用户改动，且 `docs/reading-training-10-step-workflow.md` 当前为未跟踪文件；执行实现时必须保留这些改动。本次只新增本计划文档，不修改任何源代码、配置、测试脚本或既有文档。

## 2. 已确认约束、目标与不做事项

### 2.1 已确认约束

- 目标平台仍是 Chrome/Edge Manifest V3；Side Panel 负责文章架和入口，完整训练在扩展标签页中运行。
- `toulmin-reader` Web 应用和 Cloudflare Worker 继续独立部署；本计划不把十步流程移回 Web 应用。
- 训练答案继续以文本为主，不立即引入每一步一套复杂表单字段。
- 文章正文、回答和反馈继续保存在 `chrome.storage.local`；AI 只有在用户配置 Provider 并授权后才发送请求。
- 不增加遥测、分析、账号同步、跨设备同步、Provider API key、新的 host permission 或新的外部服务。
- 现有文章段落编号由 `src/articles/format.ts:numberArticleBlocks` 统一生成；AI 提示、反馈校验、阅读预览和导出必须继续使用同一编号。
- 不把“阶段名称”作为用户流程导航；界面只显示“第 X / 10 轮”，步骤名称只作为当前问题的上下文标题。

### 2.2 本次不做

- 不自动把旧八轮答案重评分、重写或强行拆分到十轮。
- 不为第二轮新增高亮、批注、原文标注编辑器；“首句和末句标记”仍使用文本回答。
- 不改变文章抓取算法、Provider 列表、模型权限申请、Worker CORS 或 Manifest 权限。
- 不把 AI 失败降级为伪造分数或自动生成答案；失败时只保留已保存的回答并提供重试/桥接路径。
- 不在本次实现中支持 Firefox、商店发布自动化、后台全站抓取或公开数据采集。

## 3. 现状与差距

| 领域 | 当前实现与证据 | 与十步流程的差距 | 影响 |
| --- | --- | --- | --- |
| 步骤定义 | `src/training/lessons.ts:LESSON_STEPS` 当前只有 8 项；`getLessonSteps` 按语言复制步骤并替换文案 | 缺少“第一遍快速浏览”和“检查逻辑漏洞”；第 5 项把隐藏假设、因果跳跃、证据不足混在一起；第一项是“读后线索”而非严格的预读 | `currentStep`、题目、AI 提示和导出都建立在旧八轮索引上 |
| 第一轮入口 | `src/App.tsx:TrainingCoach` 有 `readConfirmed`，开始按钮要求用户先勾选“我已读完文章”；配置 AI 时 `start` 还会调用 `ai-start` | 第一步不应要求用户读完整篇文章，也不应让 AI 改写第一轮固定问题 | 流程起点与工作流文档相反，且 AI 可能把第一轮带到高级分析 |
| 会话数据 | `src/types.ts:TrainingSession` 只有 `articleId/currentStep/currentQuestion/draft/turns`；`src/storage/training.ts:isTrainingSession` 将 `currentStep` 限制在 `0..8`；`TrainingSessionStore` 只有 version 1 | 没有 `flowId` 或步骤 ID，无法区分旧八轮与新十步；若直接把 `stepIndex` 当新索引会破坏历史语义 | 旧数据无法安全解释，旧版本也无法读取新格式 |
| 存储写入 | `src/storage/training.ts:startTrainingSession/commitTrainingFeedback/rewindTrainingSession` 都按 `articleId` 操作同一 `trainingSessions` 键 | 新旧会话无法并存；旧会话没有只读边界 | 升级、回滚和用户重新开始都可能覆盖旧记录 |
| AI 出题 | `src/ai/coach.ts:buildStartPrompt` 和 `src/background.ts:startAiTraining` 允许第一轮走 AI；`ai.startReflection` 还会用预测内容改写首题 | 只有第一轮应固定；第二至第十轮才由 AI 在固定步骤范围内生成具体问题 | 题目可能跨步、提前要求下一轮能力，或把可选预测变成硬要求 |
| AI 评分 | `src/ai/coach.ts:buildGradePrompt/validateAiFeedback` 使用四个固定维度，只强制 `fidelity` 有分；当前 `LessonStep.dimensions` 未被严格用于校验 | 每一步必须只评价当前能力；未测维度应明确为 `null`，当前步骤需要的维度应有整数分 | 分数会把下一步能力提前计入，成长统计和反馈解释不稳定 |
| UI 流程 | `TrainingCoach` 只有未开始、进行中、完成/巩固三类主要分支；`coach.heading` 和完成文案写死“八轮” | 缺少第一轮后的“通读全文/快速浏览”衔接提示、旧会话只读提示和十轮进度语义 | 用户无法知道何时从预读进入全文阅读，也可能看到错误的轮数 |
| 侧栏与导出 | `src/App.tsx:SidePanel`、`src/export/reading.ts:buildReadingExportModel` 通过 `LESSON_STEPS.length` 计算进度；导出按当前步骤数组取名称 | 旧八轮导出会按新十步名称错配；旧完成会话可能显示为未完成或错误步骤 | 历史记录和用户导出的 Markdown/JSON/PDF 不可信 |
| 多语言 | `src/i18n/messages.ts` 的 zh/en/ja/ko 均包含旧“八轮”、旧步骤和旧 AI 规则 | 需要为十步名称、第一轮固定题、衔接提示、旧会话只读提示和按步评分规则提供四种语言 | 单语言修正文案会造成流程和提示词不一致 |
| 自动检查 | 现有 `scripts/check-article-format.mjs`、`check-pre-reading-prediction.mjs`、`check-storage-concurrency.mjs`、`check-extension.mjs` 只覆盖旧步骤/旧标记 | 缺少十步顺序、双键兼容、固定首题、按步评分和旧导出标签的回归检查 | 仅靠 TypeScript/build 无法发现语义错位 |

### 3.1 当前八轮到十步的语义差异

| 旧八轮 | 新十步处理 | 规则 |
| --- | --- | --- |
| `preview` / 读后线索 | 新第 1 步 `preview` / 预读 | 旧回合保留在旧流程；新第 1 步不复用旧回答 |
| `three-sentence` | 新第 3 步 | 新增第 2 步快速浏览，不能把旧第 2 轮标成新第 2 轮 |
| `three-points` | 新第 4 步 | 保持原回答和旧标签，不回填新索引 |
| `questions` | 新第 5 步 | 保持原回答和旧标签 |
| `assumptions` / 隐藏假设与漏洞 | 旧流程只读；新流程拆为第 6 步隐藏假设、第 7 步逻辑漏洞 | 不把一个旧回答复制到两个新回合 |
| `toulmin-simple` | 新第 8 步 | 旧记录继续使用旧步骤名称 |
| `toulmin-full` | 新第 9 步 | 旧记录继续使用旧步骤名称 |
| `feynman-review` | 新第 10 步 | 旧记录继续使用旧步骤名称 |

## 4. 推荐架构与数据方案

### 4.1 单一流程契约与数据流

```text
src/training/lessons.ts
  ├─→ src/storage/training.ts ─→ src/background.ts ─→ src/App.tsx
  ├─→ src/ai/coach.ts       ────┘                 └─→ src/App.css / messages
  └─→ src/export/reading.ts

旧 trainingSessions 键 ──只读规范化为 legacy-8──┐
                                                 ├─→ 可见会话
新 trainingSessionsV2 键 ──读写 reading-10───────┘
```

实现时先建立十步的稳定 ID，再让存储、AI、UI、导出都通过 ID/flow 读取；不得在这些模块中各自维护第二份步骤数组。

### 4.2 双键兼容方案

保留现有 `chrome.storage.local` 键 `trainingSessions` 作为旧八轮数据源，新增 `trainingSessionsV2` 作为十步数据源：

| 数据 | 存储键 | 读写策略 | 回滚表现 |
| --- | --- | --- | --- |
| 旧八轮 | `trainingSessions`，原数组或 `{ version: 1, items }` | 只读；在内存中补 `flowId: 'legacy-8'`，不改写原值 | 旧构建继续正常读取 |
| 新十步 | `trainingSessionsV2`，`{ version: 2, items }` | 新建、草稿、评分、回退、重置都只写这里 | 旧构建忽略该键；重新升级后十步记录仍在 |
| 删除文章 | 两个键中删除该 `articleId` | 只在用户明确删除文章时执行 | 与当前删除语义一致，需在验收中确认 |

可见会话选择顺序为“该文章的 `reading-10` 会话优先，否则返回规范化的 `legacy-8` 会话”。当用户从旧会话进入训练页时，界面必须显示旧记录为只读归档，并提供“开始十步训练”；点击后在 V2 键新建第 1 轮，不覆盖旧八轮。

建议的类型变化：

```text
TrainingFlowId = 'reading-10' | 'legacy-8'

TrainingSession 增加：
- flowId: TrainingFlowId
- stepId?: string       // 新十步新写入；旧记录可缺省

TrainingSessionStoreV2：
- version: 2
- items: TrainingSession[]

TrainingTurn 增加：
- stepId?: string       // 新回合冻结当时的步骤语义；旧回合按 legacy 索引读取
```

`currentStep` 的有效范围按流程校验：`reading-10` 为 `0..10`，`legacy-8` 为 `0..8`。旧完成记录保持 `currentStep === 8` 和原始 `turns`，不得被新 `LESSON_STEPS` 解释。

### 4.3 旧记录的读取、导出与重新开始

1. `src/storage/training.ts:normalizeLegacyTrainingSession` 将旧数组/旧 version 1 记录规范化为内存对象 `flowId: 'legacy-8'`，保留 `currentQuestion`、`draft`、`turns`、时间和反馈原值。
2. `get-training-session` 返回 V2 当前会话；没有 V2 时返回旧会话的只读视图，避免 UI 把旧索引当成新索引。
3. `start-training-session` 总是创建或返回 V2 的 `reading-10` 会话；旧会话只作为可查看历史。
4. `save-training-draft`、`ai-grade`、`prepare-ai-bridge` 和 `rewind-training-session` 对 `legacy-8` 返回明确的只读错误，不修改旧数据。
5. `src/export/reading.ts:buildReadingExportModel` 按 `session.flowId` 选择十步或旧八轮步骤标签、总轮数和完成状态；旧记录导出仍显示 `8`，新记录显示 `10`。
6. `delete-article` 同步删除两个键中的该文章记录；这是现有用户明确删除动作的延续，不作为自动迁移。

## 5. 十步训练契约

`src/training/lessons.ts:LESSON_STEPS` 必须按以下顺序固定为 10 项；`id` 是持久化和提示词使用的稳定标识，显示文案通过 `getLessonSteps(locale)` 获取。

| 轮次 | 稳定 ID | 用户看到的任务 | 主要要求 | 可评分维度 |
| ---: | --- | --- | --- | --- |
| 1 | `preview` | 预读 | 阅读已展示的标题、副标题、作者、来源，记录首段、末段、小标题、图表和强调内容带来的观察；元数据无需重复记录；信息缺失写“原文未提供” | `fidelity`, `structure` |
| 2 | `quick-browse` | 第一遍快速浏览 | 通读全文，记录段落结构、代表段意的首句/末句和转折、递进、举例、总结关系 | `fidelity`, `structure` |
| 3 | `three-sentence` | 第二遍 `分层阅读·3句法` | 按原文段落逐段回答“说了什么、为什么这么说、想告诉我什么”；单句段落可写“原文未提供” | `fidelity`, `claim`, `cause` |
| 4 | `three-points` | 全文三点总结 | 每点不超过十五字，覆盖对象/问题、原因/证据、观点/趋势/结论 | `fidelity`, `claim`, `structure` |
| 5 | `questions` | 5W1H 提问 | 提出一个最值得追问的问题，回到原文并说明它为什么重要 | `fidelity`, `cause`, `structure` |
| 6 | `assumptions` | 识别隐藏假设 | 区分原文明确说了什么、作者默认了什么、前提不成立会怎样 | `fidelity`, `cause`, `structure` |
| 7 | `logic-check` | 检查逻辑漏洞 | 指出证据不足、因果跳跃、以偏概全、忽略其他解释或结论范围过大中的一个具体风险 | `fidelity`, `cause`, `structure` |
| 8 | `toulmin-simple` | 简化图尔敏模型 | 写出主张、证据/根据、逻辑/保证 | `fidelity`, `claim`, `cause`, `structure` |
| 9 | `toulmin-full` | 完整图尔敏模型 | 在第 8 步基础上补充支撑、限定、反驳；原文没有的部分写“原文未提供” | `fidelity`, `claim`, `cause`, `structure` |
| 10 | `feynman-review` | 费曼解释与复盘 | 面向十二岁孩子解释核心观点、原因、例子/类比、适用边界和原文缺失信息 | `fidelity`, `claim`, `cause`, `structure` |

第一轮的固定问题必须是每种语言的静态文案，不调用 AI 改写：

> 请先阅读页面已展示的标题、副标题、作者和来源，再记录第一段、最后一段、小标题、图表以及强调内容带来的观察。标题、副标题、作者和来源已由系统填写，无需重复记录。只写观察，不要急着评价；原文没有提供的信息，请明确写“原文未提供”。

第一轮提交成功后固定显示：

> 预读完成。现在请通读全文，进入第一遍快速浏览。

第二轮和第三轮分别明确显示“快速浏览”和“再次精读/`分层阅读·3句法`”；第六轮只处理隐藏假设，第七轮只处理逻辑漏洞，不再使用“隐藏假设与漏洞”这个合并标题。

## 6. AI 出题、评分与错误处理方案

### 6.1 出题边界

- `src/background.ts:startAiTraining` 在 `currentStep === 0` 时直接返回当前会话，不发起网络请求；保留 `ai-start` 消息类型以兼容旧页面，但首轮调用必须幂等且无网络副作用。
- `src/App.tsx:TrainingCoach.start` 创建会话后直接显示固定首题，不再根据 API key 决定是否先调用 AI。
- 第 2 到 10 轮的具体问题由 AI 生成，但提示词必须同时包含 `stepId`、轮次、步骤要求、允许评分维度和“只提出一道问题”的规则；AI 不能跳到下一步能力，也不能输出答案或文章总结。
- `src/ai/coach.ts:buildStartPrompt` 只服务于恢复缺失问题的非首轮会话；正常前进由上一轮评分返回 `nextQuestion`。
- `preReadingPrediction` 继续保留在文章和导出中。它是可选上下文，不改变第一轮固定问题，也不成为第一轮必须回答的比较任务；不得让 `ai.startReflection` 覆盖第一轮题目。

### 6.2 评分契约

- `src/ai/coach.ts:buildGradePrompt` 根据当前 `LessonStep` 注入本轮要求和 `dimensions`；当前回答只评价当前步骤，不提前评价下一步。
- `src/ai/coach.ts:validateAiFeedback` 增加当前步骤参数：步骤声明的维度必须返回 `0..10` 整数；未声明维度必须为 `null`，理由统一使用“本题未测”或对应语言等价文案；四个维度仍保持固定 JSON 形状，避免旧反馈渲染崩溃。
- `fidelity` 仍用于所有新步骤；`totalScore` 只平均本轮声明的非空维度，不能把未测维度当成 0 分。
- `sources` 继续要求引用统一编号的原文段落，`answerQuote` 必须来自当前回答；原文未提供的支撑、限定或反驳必须由模型明确写“原文未提供”，不能补造。
- `nextQuestion` 仍只允许一个以问号结尾的问题；第 10 轮完成后可以保存可选巩固问题，但巩固回合的 `stepId` 固定为 `feynman-review`，不增加正式进度。
- 建议在提示词的 JSON 输入中加入 `stepId` 和 `stepIndex`，并在历史记录中携带 `turn.stepId`；这能让模型理解第 6/7 步的边界，也便于检查提示词是否错序。

### 6.3 回答不丢失与桥接模式

1. `TrainingCoach.submit` 先调用 `save-training-draft`，成功后才调用直连 AI 或 `prepare-ai-bridge`。
2. AI 网络失败、超时、权限不足、JSON 校验失败时，不调用 `commitTrainingFeedback`，V2 会话仍保留 `draft`、当前问题和当前轮次。
3. ChatGPT 桥接继续使用 `prepare-ai-bridge` 的 `requestId`；导入时同时校验 requestId、步骤要求、分数、回答引用、原文段落引用和 `nextQuestion`。
4. 评分成功后才由 `commitTrainingFeedback` 清空 `draft`、追加 turn 并推进 `currentStep`；第 10 轮之后只进入现有巩固分支，不把进度提升到 11。

## 7. UI 流程与状态转换

### 7.1 状态图

```text
┌────────────┐  start-training-session  ┌──────────────────────────────┐
│ idle       │ ───────────────────────→ │ step-1-preview               │
│ 无十步会话 │                           │ 第 1 / 10，固定问题，无读完勾选 │
└─────┬──────┘                           └──────────────┬───────────────┘
      │ 旧八轮可见会话                                  │ 保存草稿 → AI/桥接评分
      ▼                                                 ▼
┌────────────┐  开始十步训练                    ┌───────────────────────┐
│ legacy     │ ───────────────────────────────→ │ grading-or-bridge     │
│ 旧八轮只读 │                                   │ 失败保留当前回答       │
└────────────┘                                   └───────────┬───────────┘
                                                            │ 成功
                                                            ▼
┌──────────────────────────────┐  提交并评分  ┌─────────────────────────┐
│ step-2..10-active             │ ←────────── │ feedback + next question │
│ 第 X / 10；按轮次显示衔接提示 │              └─────────────┬───────────┘
└──────────────┬───────────────┘                            │ 第 10 轮成功
               │ 第 10 轮成功                                ▼
               └──────────────────────────────→ ┌───────────────────────┐
                                                  │ completed              │
                                                  │ 10 / 10，可回退/重开/巩固 │
                                                  └───────────┬───────────┘
                                                              │ 巩固
                                                              ▼
                                                  ┌───────────────────────┐
                                                  │ reinforcement          │
                                                  │ 不改变正式进度          │
                                                  └───────────────────────┘
```

### 7.2 具体界面行为

- `src/App.tsx:TrainingCoach`：删除首轮 `readConfirmed` 门槛；未开始时展示预读目标和“开始第一轮”，不出现“我已读完文章”。
- 进入第 1 轮后显示 `1 / 10`、固定题、预读说明和回答框；可选的阅读前预测继续在文章编辑区保存，但不替换首题。
- 第 1 轮反馈后在下一问题上方显示通读提示；第 2 轮显示“第一遍快速浏览”，第 3 轮显示“再次精读/`分层阅读·3句法`”。
- 当前轮反馈继续显示在下一问题上方；反馈失败时保留当前回答和原问题，错误信息不覆盖回答内容。
- 已完成轮次仍支持“上一步”：`rewindTrainingSession` 删除最后一个正式 turn、恢复该 turn 的 `question/answer/stepId`，并把进度回到该轮；不可回退到旧八轮记录。
- 完成状态显示 `10 / 10`、重新开始和可选巩固；重新开始只清理 V2 十步会话，旧八轮只读记录不被此操作删除。
- `legacy-8` 可见时显示“旧版八轮记录（只读）”和“开始十步训练”；不能显示 `3 / 10` 之类混合进度，也不能直接编辑旧草稿。
- `src/App.tsx:SidePanel` 的文章列表和成长统计优先读取 V2；只有旧记录时显示旧版进度/状态，不能把旧八轮计入十步完成率。
- `src/App.css` 只需扩展现有 `.coach-start`、`.coach-round`、`.round-meta`、`.progress-pill`、`.feedback-card`、`.bridge-card`、`.training-history`、`.inline-error`，以及新增的过渡提示和旧会话只读提示选择器；不重做训练页布局。

## 8. 精确修改范围

### 8.1 需要修改的文件与符号

| 文件 | 符号/范围 | 计划动作 |
| --- | --- | --- |
| `src/types.ts` | `TrainingTurn`、`TrainingSession`、`TrainingSessionStore`、`StorageState`、`ExtensionMessage` | 增加 `TrainingFlowId`、V2 存储类型、`flowId/stepId` 字段和 V2 键类型；保持消息名称兼容，必要时给训练消息增加只读旧会话返回语义，不新增网络接口 |
| `src/training/lessons.ts` | `LessonStep`、`LESSON_STEPS`、`getLessonSteps` | 建立十步 ID/顺序/要求/评分维度；保留 `LEGACY_LESSON_STEPS` 或等价旧标签 helper，供旧记录和导出使用；增加第 2、7 步并拆分第 6 步 |
| `src/storage/training.ts` | `TRAINING_SESSIONS_KEY`、`normalizeTrainingSessionStore`、`readTrainingSessions`、`getTrainingSession`、`startTrainingSession`、`saveTrainingDraft`、`setTrainingQuestion`、`commitTrainingFeedback`、`rewindTrainingSession`、`removeTrainingSession`、`isTrainingSession` | 保留旧键只读，新增 `trainingSessionsV2` 读写；实现 `normalizeLegacyTrainingSession`、V2 会话选择、按 flow 校验、首题固定、只读旧会话拒绝和并发安全更新 |
| `src/ai/coach.ts` | `buildStartPrompt`、`buildGradePrompt`、`validateAiFeedback`、`totalScore` | 注入 step ID/要求/维度；首轮不走 AI 出题；按当前步骤校验分数和 `null` 维度；继续校验回答引用、段落引用、单一问题和 JSON |
| `src/background.ts` | `startAiTraining`、`gradeAiTraining`、`prepareAiBridge`、`importAiFeedback`、`handleMessage` 中训练分支、`createBridgeRequestId` | 首轮 `ai-start` 幂等无网络；直连和桥接只处理 V2；旧会话返回只读错误；requestId 纳入 flow/step 语义，防止旧问题的反馈导入新会话 |
| `src/App.tsx` | `SidePanel` 的进度/统计、`TrainingCoach`、`FeedbackCard`、`BridgeCard` | 改为 10 轮；移除首轮读完勾选；增加旧会话只读、轮次衔接提示、固定首题和错误保留；保留现有反馈、桥接、回退、重置和巩固交互 |
| `src/App.css` | `.coach-start`、`.coach-round`、`.round-meta`、`.progress-pill`、`.feedback-card`、`.bridge-card`、`.training-history`、`.inline-error` 及新增提示选择器 | 为十步进度、过渡提示、旧版只读状态和固定问题增加最小样式；不改变现有文章预览和侧栏布局 |
| `src/i18n/messages.ts` | zh/en/ja/ko 四个 locale 对象中的 `coach.*`、`lesson.*`、`ai.*`、`feedback.*`、`bridge.*`、`export.*` | 更新十步名称、首题、通读提示、完成文案、旧版只读文案、按步评分规则和导出轮数；删除活动 UI 中“八轮”措辞，保留旧版历史标签键 |
| `src/export/reading.ts` | `ReadingExportModel`、`buildReadingExportModel`、`generateReadingMarkdown`、`generateReadingPdfHtml`、`feedbackMarkdown`、`feedbackHtml` | 按 `flowId` 计算总轮数、完成状态和步骤名称；旧八轮导出保持旧标签；新十步导出使用 10；提升 export version 时保留读取旧导出字段的兼容性，不回写文章数据 |
| `package.json` | `scripts` | 增加一个只读的十步训练检查命令，例如 `check:training-flow`；不增加依赖或运行时服务 |
| `scripts/check-reading-training-flow.mjs` | 新增脚本 | 通过 Vite SSR 加载实际模块，检查十步顺序、首题固定、AI 首轮无网络、按步评分维度、V2/旧键兼容、回退和旧导出标签 |
| `scripts/check-article-format.mjs` | 现有 prompt/feedback 断言 | 更新为带 `flowId/stepId` 的会话，并补充第 7 步逻辑漏洞和段落编号校验 |
| `scripts/check-pre-reading-prediction.mjs` | 现有源码标记断言 | 从“AI 生成首轮预测反思题”改为“首题固定、预测不覆盖首题、评分只作为可选上下文” |
| `scripts/check-storage-concurrency.mjs` | 存储 mock 与训练断言 | 覆盖 V2 并发写入、旧键不被迁移覆盖、旧会话只读、十步回退和第 10 轮完成 |
| `scripts/check-extension.mjs` | 构建产物 markers | 检查 `10`、固定首题、`quick-browse`、`logic-check`、`trainingSessionsV2`、旧会话只读和错误保留等核心逻辑；不要求新增权限 |

### 8.2 明确不修改的文件

- `public/manifest.json`：流程重组不需要新权限、Host permission 或入口；发布前只做一致性检查。
- `src/storage/articles.ts`、`src/articles/format.ts`、`src/ai/providers.ts`：文章存储、段落编号和 Provider 权限边界保持现状；只通过既有接口复用。
- `CONTEXT.md`、`docs/adr/0001-chrome-mv3-side-panel.md`：目标浏览器、部署边界和数据边界未改变；实现不应借机更新架构决策。
- 原 Web 应用和 Cloudflare Worker 仓库：不在本项目十步重组范围内。

## 9. 分阶段实施与 TODO

### Phase 1：课程与兼容数据核心

1. **冻结十步 ID 和评分维度**（文件：`src/training/lessons.ts`、`src/types.ts`、`src/i18n/messages.ts`）
   - Action：写入十步稳定 ID、顺序、固定首题、衔接提示和四语言文案；新增 `TrainingFlowId`、V2 store 类型和可选 `TrainingTurn.stepId`。
   - Why：所有后续模块必须依赖同一契约，避免先改 UI 再改存储造成索引漂移。
   - Dependencies：无。
   - Risk：Medium；步骤 ID 一旦写入新会话，不应随意重命名。

2. **建立旧键只读与 V2 双键存储**（文件：`src/storage/training.ts`、`src/types.ts`）
   - Action：保留 `trainingSessions` 原值；新增 `trainingSessionsV2` 的读写、可见会话优先级、旧会话规范化和按 flow 的边界校验。
   - Why：避免旧八轮被错误重解释，也让旧构建可以安全回滚。
   - Dependencies：步骤 1。
   - Risk：High；必须验证并发写入、文章删除、旧数组/version 1、空值和损坏条目。

3. **实现十步本地状态机**（文件：`src/storage/training.ts`、`src/background.ts`、`src/App.tsx`）
   - Action：首轮创建时写入固定问题；提交前保存草稿；成功评分后推进 `0..10`；回退恢复 question/answer/stepId；旧会话只读；完成后的巩固不改变正式进度。
   - Why：先保证无 AI 或桥接模式也能完整走完十步，持久化行为可独立验收。
   - Dependencies：步骤 1 到 2。
   - Risk：High；任何评分失败都不得清空 draft 或增加 turn。

4. **更新训练页面状态和衔接文案**（文件：`src/App.tsx`、`src/App.css`、`src/i18n/messages.ts`）
   - Action：移除首轮 `readConfirmed` 门槛；渲染 `1 / 10`；增加第 1 轮后的通读提示、第 2/3 轮提示、旧会话只读分支和十步完成文案。
   - Why：让 UI 真实表达工作流，而不是只把数字从 8 改成 10。
   - Dependencies：步骤 1 到 3。
   - Risk：Medium；刷新、回退、桥接输入和完成/巩固分支必须保持现有行为。

### Phase 2：AI 合约、导出和回归保护

5. **限制 AI 出题范围并实现按步评分**（文件：`src/ai/coach.ts`、`src/background.ts`）
   - Action：首轮 `ai-start` 无网络；第 2 到 10 轮提示词携带 step ID、要求和维度；校验当前步骤的数值分和未测维度；保留原文段落编号和回答引用校验。
   - Why：十步不是只改进度数字，AI 必须知道当前只评价哪一种能力。
   - Dependencies：Phase 1 的类型、步骤和状态机。
   - Risk：High；模型可能返回跨步问题、错误 JSON、无效引用或不合规分数。

6. **对齐 ChatGPT 桥接与错误重试**（文件：`src/background.ts`、`src/App.tsx`、`src/i18n/messages.ts`）
   - Action：把 V2 flow/step 纳入 requestId 校验；桥接 prompt 使用十步要求；导入失败不清空回答；旧会话禁止导入。
   - Why：未配置 API key 的本地模式仍必须可用，且反馈错配不能污染新会话。
   - Dependencies：步骤 5。
   - Risk：Medium；需要覆盖复制、粘贴超长 JSON、旧 requestId 和用户重复提交。

7. **修正导出和侧栏统计**（文件：`src/export/reading.ts`、`src/App.tsx`、`src/i18n/messages.ts`）
   - Action：新会话导出 `10` 轮和十步名称；旧会话导出 `8` 轮和旧标签；侧栏不把旧完成记录计入十步完成统计；Markdown/JSON/PDF 保留草稿和反馈。
   - Why：导出是用户可长期保存的结果，不能随课程升级改变历史语义。
   - Dependencies：Phase 1 到 2 的 flowId 和 legacy helper。
   - Risk：Medium；需防止旧 `stepIndex` 被新步骤数组索引。

8. **补齐自动回归检查**（文件：`package.json`、`scripts/check-reading-training-flow.mjs`、现有四个 check 脚本）
   - Action：加入十步顺序、固定首题、无首轮 AI 请求、双键兼容、按步评分、段落引用、回退、旧导出和 dist marker 断言。
   - Why：现有 lint/build 无法验证训练语义。
   - Dependencies：步骤 1 到 7。
   - Risk：Low；脚本应使用最小 mock，不依赖真实 Provider 或个人 API key。

### Phase 3：发布前验收

9. **运行静态和构建检查**（仓库根目录）
   - Action：按“测试与发布检查”执行 `pnpm install`、`pnpm lint`、TypeScript、`pnpm build` 和所有 check 脚本；若 `pnpm lint` 继续受当前环境包装器影响，额外记录直接 Oxlint 结果，不把包装器失败隐瞒为通过。
   - Why：确认源码、类型、构建产物和扩展清单一致。
   - Dependencies：步骤 8。
   - Risk：Medium；真实浏览器行为仍不能由构建替代。

10. **完成 Chrome/Edge 手工矩阵并记录结果**（不新增文件）
    - Action：在干净浏览器配置加载解压扩展，覆盖普通文章、选区、手动粘贴、刷新恢复、十轮顺序、AI 失败、桥接导入、旧八轮、删除、导出和回退。
    - Why：验证 Side Panel、扩展标签页、`chrome.storage.local` 和已声明网络权限的真实交互。
    - Dependencies：步骤 9。
    - Risk：High；需要用户自己的 Provider API key 才能验证真实 AI 请求，不能把未配置环境的本地/桥接测试冒充直连 AI 验收。

11. **发布包和回滚检查**（`dist/`、`public/manifest.json`、Git 工作树）
    - Action：检查 manifest 引用的文件、权限未扩大、四语言资源齐全、构建 bundle 没有密钥/遥测/意外网络；确认 `git diff --name-only` 只包含预期实现文件和不相关的既有用户改动没有被覆盖。
    - Why：确保十步重组不会改变扩展权限或数据边界。
    - Dependencies：步骤 9 到 10。
    - Risk：Medium；当前工作树不干净，提交或回滚必须按文件审查，禁止使用破坏性 reset。

## 10. 测试、手工验证与发布检查

### 10.1 自动检查顺序

最快相关检查先运行：

```text
pnpm check:training-flow
pnpm check:article-format
pnpm check:pre-reading
pnpm check:storage-concurrency
node_modules/.bin/tsc --noEmit
pnpm lint
pnpm build
node scripts/check-extension.mjs
```

若依赖或 lockfile 有变化，先运行 `pnpm install`。当前项目没有 Jest/Vitest 测试目录，训练回归使用现有 Node/Vite check 脚本；不新增测试框架。

自动断言至少包括：

- `LESSON_STEPS.length === 10`，ID 顺序严格为 `preview → quick-browse → three-sentence → three-points → questions → assumptions → logic-check → toulmin-simple → toulmin-full → feynman-review`。
- 首题完全来自本地 `getLessonSteps(locale)[0].question`，调用 `ai-start` 不触发 fetch。
- 第 1 轮 prompt 不要求完整阅读，提交后下一步为 `quick-browse`；第 6/7 步 prompt 不混用名称或评分规则。
- `validateAiFeedback` 对当前步骤维度接受整数、对未测维度拒绝非空分数；原文和回答引用仍严格校验。
- 旧数组/version 1 从 `trainingSessions` 读取为 `legacy-8`；创建十步会话只写 `trainingSessionsV2`，旧键字节级内容不被迁移覆盖。
- 新十步会话并发保存只产生一份当前 session；回退恢复上一轮问题、回答和 step ID；第 10 轮完成状态为 `10 / 10`。
- 旧八轮导出仍为 `8` 轮并使用旧步骤标签，新导出为 `10` 轮；段落引用编号与阅读预览一致。
- 生产 bundle 包含十步核心标记、首题、V2 key、错误保留和桥接入口，不包含新的未声明权限或敏感值。

### 10.2 手工验收矩阵

| 场景 | 操作 | 通过标准 |
| --- | --- | --- |
| 新文章入口 | 从普通新闻/博客页捕获并保存 | 文章、段落编号、预读输入和十步训练入口可用 |
| 第一轮 | 不勾选“已读完”，直接开始 | 可以进入 `1 / 10`；首题固定；不发送 AI 请求 |
| 第一轮衔接 | 提交第一轮并完成评分 | 显示“预读完成，请通读全文”，下一题属于快速浏览 |
| 第二/三轮 | 分别快速浏览、再次精读并提交 | UI 和 AI prompt 不把两轮合并；第 3 轮显示 `分层阅读·3句法` |
| 第六/七轮 | 分别回答隐藏假设和逻辑漏洞 | 题目、评分维度、反馈和历史名称严格分开 |
| 第八/九轮 | 完成简化、完整图尔敏 | 第 8 轮只有主张/证据/逻辑任务，第 9 轮补支撑/限定/反驳 |
| 第十轮 | 完成费曼解释与复盘 | 包含通俗解释、例子/类比、边界和未提供信息；进度为 `10 / 10` |
| AI 失败 | 断网、拒绝权限、返回坏 JSON 或超时 | 当前回答仍在本地，显示错误，可重试或生成桥接请求，进度不前进 |
| 桥接导入 | 复制请求、导入正确/错误 requestId 和错误引用 | 正确反馈才推进；错误反馈不清空回答、不污染会话 |
| 刷新与回退 | 每轮草稿中刷新；评分后点击上一步 | 草稿、问题、反馈和进度按约定恢复；回退后可以重新评分 |
| 旧八轮 | 预置旧 `trainingSessions` 后打开文章 | 显示旧版八轮只读；开始十步后 V2 新建 `1 / 10`；旧记录仍可导出为 8 轮 |
| 重置/删除 | 重置十步；删除文章 | 重置只清理 V2；删除文章才同时清理两个键；列表和成长统计同步更新 |
| 多语言 | 切换 zh-CN/en/ja/ko 并重复首轮/反馈/导出 | 步骤顺序、固定首题、过渡提示和导出标题没有回退到旧八轮或缺键 |
| Chrome/Edge | 两个浏览器分别加载同一 dist | Side Panel、训练标签页、快捷键、存储和权限行为均通过；无 Firefox 兼容承诺 |

### 10.3 发布检查

- `dist/manifest.json` 的入口、图标、Side Panel、`training.html`、`print.html`、`settings.html` 和四语言资源都存在。
- Manifest 权限集合与现有行为一致；不新增页面访问权限、optional host permission、Worker URL 或遥测请求。
- `node scripts/check-extension.mjs` 通过；构建产物不包含 API key、私有 token 或本地环境值。
- 真实直连 AI 验收只使用用户明确配置的 key，测试日志和导出记录不包含 key；未配置 key 的本地/桥接路径仍可完成流程。
- 预览、AI 反馈、Markdown/JSON/PDF 导出中的段落编号一致；旧八轮导出不被十步名称覆盖。
- 发布前保留一份旧 `trainingSessions` 和新 `trainingSessionsV2` 的脱敏结构样本用于回归，不提交真实文章或密钥。
- 在不干净工作树上只提交明确审查过的计划实现文件；不要用 `git reset --hard` 或整目录 checkout 清理其他用户改动。

## 11. 风险、回滚方式与缓解

| 风险 | 触发条件 | 缓解/回滚 |
| --- | --- | --- |
| 旧索引被新数组误读 | 导出或 UI 直接使用 `LESSON_STEPS[turn.stepIndex]` | 所有读路径先判断 `flowId`；旧记录使用 `LEGACY_LESSON_STEPS`；增加旧导出断言 |
| 存储升级破坏旧构建 | 把 version 1 原地改成 version 2 | 采用独立 `trainingSessionsV2`；旧键不迁移、不改写；回滚旧构建时旧八轮继续可读 |
| AI 越级出题或评分 | 模型忽略当前步骤指令 | prompt 同时传 step ID/要求/维度；校验未测维度和引用；失败不 commit；必要时走桥接重试 |
| 首轮被预测或 AI 改写 | 继续使用 `ai.startReflection` 或 `ai-start` | 首题由本地 lesson 常量提供；预测只作可选上下文；自动检查断言首轮无 fetch |
| AI 失败丢回答 | 先评分后保存，或失败时清空 draft | 提交顺序固定为 save draft → AI/桥接 → validate → commit；手工断网测试 |
| 段落编号不一致 | AI 使用原始文本分段而 UI 使用 block 分段 | 继续复用 `numberArticleBlocks(getArticleBlocks(...))`；保留现有段落回归检查 |
| 多语言文案错位 | 只更新 zh-CN 或动态 key 缺失 | 四个 locale 同步更新；`check:i18n`、切换语言手工验收和 bundle marker 检查 |
| 并发提交重复 turn | 多次点击或多个标签页同时写入 | 复用 `createKeyedMutationQueue`；按钮 busy 状态只作 UX，存储层仍做幂等/边界检查 |
| 工作树已有改动被覆盖 | 实现时执行 reset、批量格式化或覆盖相邻文件 | 每阶段先 `git status --short`；只用小补丁；发布前逐文件审查 diff |

### 11.1 回滚步骤

1. 发布前发现问题：停止发布，保留 `trainingSessionsV2`，回到上一个已验证的扩展构建并在浏览器中重新加载；`trainingSessions` 旧数据不受影响。
2. 已发布后发现问题：撤回十步实现提交或重新加载旧构建；旧构建暂时看不到 V2 十步记录，但不会删除它们，用户重新升级后可继续查看。
3. 只有用户明确删除文章时才清理两个键；禁止把“回滚”实现为清空 `trainingSessionsV2`。
4. 若必须停用十步入口，优先回退 UI/路由代码并保留 V2 原始数据；不要做不可逆的数据转换。

## 12. 成功标准

- [x] 新会话顺序严格为十步流程，显示进度为 `第 X / 10 轮`。
- [x] 第一轮是预读，不要求用户先读完整篇文章，问题固定且不调用 AI 出题。
- [x] 第一轮提交后明确提示通读全文；第二轮为快速浏览；第三轮为 `分层阅读·3句法`。
- [x] 第六轮只识别隐藏假设，第七轮专门检查逻辑漏洞。
- [x] 第八轮和第九轮分别是简化/完整图尔敏模型；第十轮包含费曼解释、例子和适用边界。
- [x] AI 第 2 到 10 轮只生成当前步骤范围内的问题；评分只评价当前步骤能力，原文未提供的信息不被补造。
- [x] AI、权限、网络或 JSON 失败时，已提交回答仍保留，用户可重试或使用桥接评分，已通过代码路径和回归检查验证。
- [x] 新十步会话写入 `trainingSessionsV2`；旧八轮记录在 `trainingSessions` 中可读、可导出、不可被错误重解释。
- [x] 已完成轮次可以回退上一轮；完成后可重开或巩固，且正式进度不会超过 `10 / 10`。
- [ ] 本地模式、直连 AI、ChatGPT 桥接、文章抓取、手动粘贴、刷新恢复和删除联动均已在真实扩展环境中完成手工矩阵验收。
- [x] TypeScript、直接 Oxlint、build、训练回归脚本和扩展构建产物检查均已通过；`rtk bypass pnpm lint` 通过，但当前环境的 RTK 会把 `pnpm lint` 改写为 ESLint 专用包装器，Chrome/Edge 手工矩阵仍待真实扩展环境验证。

## 13. 未决问题

以下问题不应阻塞技术方案；若没有新的产品决定，按“推荐默认”执行：

1. **旧八轮记录的用户体验**：是只读归档并新建十步，还是允许用户继续完成旧八轮？推荐只读归档 + 新建十步，原因是旧流程不应继续被新代码评分，且回滚最安全。负责人：产品/训练设计。
2. **阅读前预测的评分定位**：是把预测与原文对照作为第一轮硬要求，还是仅作为文章上下文？推荐仅作为可选上下文，因为十步文档规定第一轮只记录观察，不能提前评价或下结论。负责人：训练设计。
3. **第 2 到 10 轮是否允许用户切换 AI 生成问题**：推荐不提供手动改题入口；题目由 AI 在固定步骤契约内生成，失败时重试或走桥接，避免用户跳步。负责人：产品/训练设计。
4. **非中文 locale 的教学文案最终审校人**：技术上四个 locale 必须同步提供可用文案，发布前仍需指定审校人确认术语，尤其是 `warrant/backing/qualifier/rebuttal` 的译法。负责人：本地化维护者。

