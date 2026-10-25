import type { CaptureRecord, SavedArticle, TrainingSession } from '../types'
import { LESSON_STEPS } from '../training/lessons'

const STAGE_NAMES = ['基础理解', '批判性提问', '简化图尔敏', '完整论证']
const DIMENSION_LABELS = {
  fidelity: '忠于原文',
  claim: '核心主张提炼',
  cause: '从现象进入原因',
  structure: '论证结构',
}

export const MAX_OBSIDIAN_URI_LENGTH = 6_000

export type ReadingExportModel = {
  exportVersion: 1
  title: string
  metadata: { subtitle: string; author: string; source: string }
  url: string
  created: string
  exportedAt: string
  favorite: boolean
  status: 'unread' | 'in-progress' | 'completed'
  progress: { completed: number; total: number }
  averageScore: number | null
  articleParagraphs: string[]
  turns: Array<{
    number: number
    stage: string
    step: string
    question: string
    answer: string
    date: string
    feedback: NonNullable<TrainingSession['turns'][number]['feedback']> | null
  }>
  draft: string
}

export function buildReadingExportModel(
  article: CaptureRecord | SavedArticle,
  session: TrainingSession | null,
  now = new Date(),
): ReadingExportModel {
  const metadata = article.metadata ?? {
    subtitle: '',
    author: article.author?.trim() ?? '',
    source: '',
  }
  const turns = session?.turns ?? []
  return {
    exportVersion: 1,
    title: article.title.trim() || '未命名文章',
    metadata: {
      subtitle: metadata.subtitle.trim(),
      author: metadata.author.trim(),
      source: metadata.source.trim(),
    },
    url: article.url.trim(),
    created: article.capturedAt,
    exportedAt: now.toISOString(),
    favorite: 'isFavorite' in article && article.isFavorite === true,
    status: turns.length >= LESSON_STEPS.length ? 'completed' : turns.length ? 'in-progress' : 'unread',
    progress: { completed: Math.min(LESSON_STEPS.length, turns.length), total: LESSON_STEPS.length },
    averageScore: averageScore(turns),
    articleParagraphs: splitArticle(article.text),
    turns: turns.map((turn, index) => ({
      number: index + 1,
      stage: STAGE_NAMES[Math.min(3, Math.floor(turn.stepIndex / 2))] ?? STAGE_NAMES[0],
      step: LESSON_STEPS[turn.stepIndex]?.name ?? '阅读训练',
      question: turn.question,
      answer: turn.answer,
      date: turn.submittedAt,
      feedback: turn.feedback ?? null,
    })),
    draft: session?.draft ?? '',
  }
}

export function generateReadingJson(model: ReadingExportModel) {
  return `${JSON.stringify(model, null, 2)}\n`
}

export function sanitizeFilename(title: string, extension = 'md') {
  const base = title
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .split('')
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('')
    .slice(0, 120)
    .trim() || '未命名文章'
  return `${base} - 问读.${extension.replace(/^\./, '')}`
}

export function generateReadingMarkdown(model: ReadingExportModel) {
  const lines = [
    '---',
    `export_version: ${model.exportVersion}`,
    `title: ${yamlString(model.title)}`,
    `subtitle: ${yamlString(model.metadata.subtitle)}`,
    `author: ${yamlString(model.metadata.author)}`,
    `source: ${yamlString(model.metadata.source)}`,
    `url: ${yamlString(model.url)}`,
    `created: ${yamlString(model.created)}`,
    `exported_at: ${yamlString(model.exportedAt)}`,
    `status: ${model.status}`,
    `progress: ${yamlString(`${model.progress.completed}/${model.progress.total}`)}`,
    `average_score: ${model.averageScore === null ? 'null' : model.averageScore}`,
    `favorite: ${model.favorite ? 'true' : 'false'}`,
    'tags:',
    '  - wendu',
    '  - reading',
    '  - toulmin',
    '---',
    '',
    `# ${escapeMarkdownBlock(model.title)}`,
    '',
    '## 文章信息',
    '',
    `- 训练状态：${model.status === 'completed' ? '已完成' : model.status === 'in-progress' ? '训练中' : '待读'}`,
    `- 完成轮次：${model.progress.completed} / ${model.progress.total}`,
    `- 平均分：${model.averageScore === null ? '尚未评分' : `${model.averageScore} / 100`}`,
    ...(model.metadata.subtitle ? [`- 副标题：${escapeMarkdownBlock(model.metadata.subtitle)}`] : []),
    ...(model.metadata.author ? [`- 作者：${escapeMarkdownBlock(model.metadata.author)}`] : []),
    ...(model.metadata.source ? [`- 来源：${escapeMarkdownBlock(model.metadata.source)}`] : []),
    ...(model.url ? [`- URL：${escapeMarkdownBlock(model.url)}`] : []),
    '',
    '## 原文',
    '',
  ]

  model.articleParagraphs.forEach((paragraph) => lines.push(escapeMarkdownBlock(paragraph), ''))
  lines.push('## 训练记录', '')
  if (!model.turns.length) lines.push('尚未提交训练回答。', '')
  model.turns.forEach((turn) => {
    lines.push(
      `### 第 ${turn.number} 轮 · ${turn.stage} · ${turn.step}`,
      '',
      '#### 问题',
      '',
      escapeMarkdownBlock(turn.question) || '未记录问题',
      '',
      '#### 我的回答',
      '',
      escapeMarkdownBlock(turn.answer) || '未记录回答',
      '',
      ...feedbackMarkdown(turn.feedback),
      '',
    )
  })
  if (model.draft) lines.push('## 当前未提交草稿', '', escapeMarkdownBlock(model.draft), '')
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function generateReadingPdfHtml(model: ReadingExportModel) {
  const paragraphs = model.articleParagraphs
    .map((paragraph, index) => `<p class="source-paragraph"><span>${String(index + 1).padStart(2, '0')}</span>${escapeHtml(paragraph)}</p>`)
    .join('')
  const turns = model.turns.length
    ? model.turns.map((turn) => `<article class="turn"><h3>第 ${turn.number} 轮 · ${escapeHtml(turn.stage)} · ${escapeHtml(turn.step)}</h3><h4>问题</h4>${htmlParagraphs(turn.question)}<h4>我的回答</h4>${htmlParagraphs(turn.answer)}${feedbackHtml(turn.feedback)}</article>`).join('')
    : '<p>尚未提交训练回答。</p>'
  const subtitle = model.metadata.subtitle ? `<p class="subtitle">${escapeHtml(model.metadata.subtitle)}</p>` : ''
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><title>${escapeHtml(model.title)} - 问读</title><style>*{box-sizing:border-box}body{margin:0;background:#fffefa;color:#3f4e3b;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif;line-height:1.75}.toolbar{display:flex;justify-content:space-between;max-width:920px;margin:0 auto;padding:20px 28px;border-bottom:1px solid #dfe7d5;color:#809274;font-size:13px}.toolbar button{border:0;border-radius:6px;background:#728c5c;color:#fffefa;padding:9px 14px;font:inherit;cursor:pointer}.report{max-width:920px;margin:0 auto;padding:38px 28px 60px}.report h1,.report h2,.report h3{font-family:Georgia,"Songti SC","Noto Serif SC",serif;font-weight:500;color:#526b47}.report h1{font-size:32px;margin:0 0 4px}.report h2{font-size:22px;margin:36px 0 13px;border-bottom:1px solid #e4eadb;padding-bottom:8px}.report h3{font-size:17px;margin:28px 0 12px}.report h4{font-size:12px;color:#768d66;margin:18px 0 5px}.meta,.subtitle{color:#8a9a7f;font-size:12px}.source{background:#fafbf5;border:1px solid #e1e9d7;padding:20px 22px}.source-paragraph{position:relative;padding-left:34px;margin:0 0 22px;font-family:Georgia,"Songti SC","Noto Serif SC",serif;font-size:15px;line-height:2.05;white-space:pre-wrap}.source-paragraph span{position:absolute;left:0;top:5px;color:#aab79d;font:10px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.turn{border:1px solid #e1e9d7;border-radius:8px;padding:18px 20px;margin:16px 0;break-inside:avoid}.feedback{border-top:1px dashed #d7e2ca;margin-top:18px;padding-top:8px}.dimensions{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:0;list-style:none}.dimensions li{background:#f1f5ea;border-radius:5px;padding:8px 10px}.dimensions strong{color:#698257}.dimensions span{float:right;color:#7b9368}.dimensions p,.feedback p{margin:3px 0;font-size:12px;color:#64745d}.feedback ul{padding-left:22px}.feedback blockquote{margin:5px 0;padding-left:10px;border-left:2px solid #c7d5b5;color:#65775e}.note{margin-top:24px;color:#a2af98;font-size:11px}@media print{.toolbar{display:none}.report{max-width:none;padding:0}.source,.turn{break-inside:auto}}@media(max-width:700px){.toolbar,.report{padding-left:18px;padding-right:18px}.report h1{font-size:26px}.dimensions{grid-template-columns:1fr}}</style></head><body><div class="toolbar"><span>问读训练记录 · ${model.progress.completed}/${model.progress.total} 轮</span><button type="button" onclick="window.print()">保存为 PDF</button></div><main class="report"><h1>${escapeHtml(model.title)}</h1>${subtitle}<p class="meta">训练状态：${escapeHtml(model.status)} · 平均分：${escapeHtml(model.averageScore === null ? '尚未评分' : `${model.averageScore} / 100`)}</p><h2>原文</h2><section class="source">${paragraphs || '<p>原文为空。</p>'}</section><h2>训练记录</h2>${turns}${model.draft ? `<h2>当前未提交草稿</h2>${htmlParagraphs(model.draft)}` : ''}<p class="note">由问读导出，原文、回答和反馈均来自当前浏览器记录。</p></main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));</script></body></html>`
}

export function buildObsidianUrl(markdown: string, options: { vault?: string; path?: string; title?: string } = {}) {
  const params = []
  if (text(options.vault)) params.push(encodedParam('vault', text(options.vault)))
  if (text(options.path)) params.push(encodedParam('file', text(options.path)))
  else if (text(options.title)) params.push(encodedParam('name', text(options.title)))
  params.push(encodedParam('silent', 'true'), encodedParam('content', markdown))
  const directUrl = `obsidian://new?${params.join('&')}`
  if (directUrl.length <= MAX_OBSIDIAN_URI_LENGTH) return { url: directUrl, useClipboard: false }
  const fallback = params.filter((param) => !param.startsWith('content='))
  fallback.push(encodedParam('clipboard', 'true'))
  return { url: `obsidian://new?${fallback.join('&')}`, useClipboard: true }
}

function averageScore(turns: TrainingSession['turns']) {
  const scores = turns.map((turn) => turn.feedback?.total).filter((score): score is number => score !== undefined)
  return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null
}

function feedbackMarkdown(feedback: NonNullable<TrainingSession['turns'][number]['feedback']> | null) {
  if (!feedback) return ['尚未评分。']
  const lines = ['#### 评分', '']
  Object.entries(DIMENSION_LABELS).forEach(([key, label]) => {
    const dimension = feedback.dimensions[key as keyof typeof feedback.dimensions]
    lines.push(`- ${label}：${dimension.score === null ? '本题未测' : `${dimension.score} / 10`}`)
  })
  appendObservations(lines, '具体优点', feedback.strengths, '本轮没有记录可证实的优点。')
  appendObservations(lines, '还需要打磨', feedback.gaps, '本轮没有记录明确不足。')
  lines.push('', '#### 原文依据', '')
  feedback.sources.forEach((source) => {
    lines.push(`- 第 ${source.paragraph} 段：${blockquote(source.quote).replace(/\n/g, '\n  ')}`)
    lines.push(`  ${escapeMarkdownBlock(source.comment)}`)
  })
  lines.push('', '#### 下一问题', '', escapeMarkdownBlock(feedback.nextQuestion))
  return lines
}

function appendObservations(lines: string[], heading: string, items: Array<{ answerQuote: string; comment: string }>, empty: string) {
  lines.push('', `#### ${heading}`, '')
  if (!items.length) {
    lines.push(empty)
    return
  }
  items.forEach((item) => {
    lines.push(item.answerQuote ? `- ${blockquote(item.answerQuote).replace(/\n/g, '\n  ')}` : `- ${escapeMarkdownBlock(item.comment)}`)
    if (item.answerQuote) lines.push(`  ${escapeMarkdownBlock(item.comment)}`)
  })
}

function feedbackHtml(feedback: NonNullable<TrainingSession['turns'][number]['feedback']> | null) {
  if (!feedback) return '<p>尚未评分。</p>'
  const dimensions = Object.entries(DIMENSION_LABELS).map(([key, label]) => {
    const dimension = feedback.dimensions[key as keyof typeof feedback.dimensions]
    return `<li><strong>${escapeHtml(label)}</strong><span>${escapeHtml(dimension.score === null ? '本题未测' : `${dimension.score} / 10`)}</span><p>${escapeHtml(dimension.reason)}</p></li>`
  }).join('')
  const observations = (items: Array<{ answerQuote: string; comment: string }>, empty: string) => items.length
    ? `<ul>${items.map((item) => `<li>${item.answerQuote ? `<blockquote>${htmlParagraphs(item.answerQuote)}</blockquote>` : ''}<p>${htmlParagraphs(item.comment)}</p></li>`).join('')}</ul>`
    : `<p>${escapeHtml(empty)}</p>`
  const sources = `<ul>${feedback.sources.map((source) => `<li><strong>第 ${source.paragraph} 段</strong><blockquote>${htmlParagraphs(source.quote)}</blockquote><p>${htmlParagraphs(source.comment)}</p></li>`).join('')}</ul>`
  return `<section class="feedback"><h4>评分</h4><ul class="dimensions">${dimensions}</ul><h4>具体优点</h4>${observations(feedback.strengths, '本轮没有记录可证实的优点。')}<h4>还需要打磨</h4>${observations(feedback.gaps, '本轮没有记录明确不足。')}<h4>原文依据</h4>${sources}<h4>下一问题</h4>${htmlParagraphs(feedback.nextQuestion)}</section>`
}

function splitArticle(article: string) {
  return article.split(/\n\s*\n|\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
}

function escapeMarkdownBlock(value: string) {
  return value.trim().replace(/^([#>*+\-`])/gm, '\\$1')
}

function blockquote(value: string) {
  const lines = value.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `> ${escapeMarkdownBlock(line)}`)
  return lines.length ? lines.join('\n') : '> '
}

function yamlString(value: string) {
  return JSON.stringify(value.trim())
}

function htmlParagraphs(value: string) {
  return value.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join('') || '<p>未提供</p>'
}

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function text(value: string | undefined) {
  return value?.trim() ?? ''
}

function encodedParam(key: string, value: string) {
  return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}
