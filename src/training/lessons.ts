export type LessonStep = {
  id: string
  stage: string
  name: string
  focus: string
  instruction: string
  question: string
}

export const LESSON_STEPS: LessonStep[] = [
  {
    id: 'preview',
    stage: '基础理解',
    name: '预读记录',
    focus: '标题、作者、来源、首段与末段',
    instruction: '只记录预读观察，不急着总结全文；原文没有提供的信息请明确写“原文未提供”。',
    question: '标题、作者、来源、首段和末段分别给了你哪些线索？只写观察，不要急着评价。',
  },
  {
    id: 'three-sentence',
    stage: '基础理解',
    name: '分层阅读 · 3句法',
    focus: '主题、理由/证据、段落判断',
    instruction: '选择一个关键段落，用三句话说明它说了什么、为什么这么说、想告诉你什么。',
    question: '选择一个最关键的段落，用三句话回答：这段说了什么？为什么这么说？它想告诉你什么？',
  },
  {
    id: 'three-points',
    stage: '批判性提问',
    name: '全文三点总结',
    focus: '三个不超过十五字的要点',
    instruction: '只写原文明确表达的内容，不添加外部知识或评价。',
    question: '用三个不超过十五字的要点概括全文。先写原文明确说出的内容，不补充外部信息。',
  },
  {
    id: 'questions',
    stage: '批判性提问',
    name: '5W1H 提问',
    focus: '提出最值得追问的问题',
    instruction: '提出一个关键问题，并说明它为什么值得优先追问，不替作者回答。',
    question: '围绕文章最关键的一处，提出一个最值得追问的 5W1H 问题，并说明它为什么比其他问题更关键。',
  },
  {
    id: 'assumptions',
    stage: '简化图尔敏',
    name: '隐藏假设与漏洞',
    focus: '未说出的前提与其他解释',
    instruction: '指出一处作者可能默认的前提、因果跳跃或证据不足，并引用原文说明依据。',
    question: '指出一处作者可能默认的前提、因果跳跃或证据不足，并引用原文说明它为什么引起你的怀疑。',
  },
  {
    id: 'toulmin-simple',
    stage: '简化图尔敏',
    name: '简化图尔敏',
    focus: '主张、证据、保证',
    instruction: '拆出 Claim、Data/Grounds 和 Warrant，区分原文明说与自己的推断。',
    question: '选择一条核心论证，分别写出主张、证据/根据和保证：为什么这些证据能够支持这个主张？',
  },
  {
    id: 'toulmin-full',
    stage: '完整论证',
    name: '完整图尔敏',
    focus: '支援、限定、反驳',
    instruction: '继续分析 Backing、Qualifier、Rebuttal；原文没有的部分写“未交代”。',
    question: '在上一轮论证上继续分析：有哪些支援？作者用了哪些限定词？是否回应了反驳或例外？',
  },
  {
    id: 'feynman-review',
    stage: '完整论证',
    name: '费曼解释与复盘',
    focus: '面向外行讲清楚并指出边界',
    instruction: '解释核心论证、关键证据和一个限制，并写出自己仍不确定的一点。',
    question: '假设要向不了解这篇文章的人解释它：说清核心论证、最重要的证据和一个限制，最后指出你仍不确定的一点。',
  },
]

