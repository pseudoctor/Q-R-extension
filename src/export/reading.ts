import type { ArticleBlock, CaptureRecord, Locale, SavedArticle, TrainingSession } from '../types'
import { articleBlocksToText, getArticleBlocks } from '../articles/format'
import { articleBlocksToMarkdown } from './markdown'
import { getLessonSteps, LESSON_STEPS } from '../training/lessons'
import { translate } from '../i18n/messages'

export const MAX_OBSIDIAN_URI_LENGTH = 6_000

export type ReadingExportModel = {
  exportVersion: 3
  locale: Locale
  title: string
  metadata: { subtitle: string; author: string; source: string }
  preReadingPrediction: string
  url: string
  created: string
  exportedAt: string
  favorite: boolean
  status: 'unread' | 'in-progress' | 'completed'
  progress: { completed: number; total: number }
  averageScore: number | null
  articleBlocks: ArticleBlock[]
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
  locale: Locale = 'zh-CN',
  now = new Date(),
): ReadingExportModel {
  const metadata = article.metadata ?? {
    subtitle: '',
    author: article.author?.trim() ?? '',
    source: '',
  }
  const turns = session?.turns ?? []
  const articleBlocks = getArticleBlocks(article.text, article.blocks)
  const steps = getLessonSteps(locale)
  return {
    exportVersion: 3,
    locale,
    title: article.title.trim() || translate(locale, 'common.untitled'),
    metadata: {
      subtitle: metadata.subtitle.trim(),
      author: metadata.author.trim(),
      source: metadata.source.trim(),
    },
    preReadingPrediction: article.preReadingPrediction?.trim() ?? '',
    url: article.url.trim(),
    created: article.capturedAt,
    exportedAt: now.toISOString(),
    favorite: 'isFavorite' in article && article.isFavorite === true,
    status: turns.length >= LESSON_STEPS.length ? 'completed' : turns.length ? 'in-progress' : 'unread',
    progress: { completed: Math.min(LESSON_STEPS.length, turns.length), total: LESSON_STEPS.length },
    averageScore: averageScore(turns),
    articleBlocks,
    articleParagraphs: splitArticle(articleBlocksToText(articleBlocks)),
    turns: turns.map((turn, index) => ({
      number: index + 1,
      stage: steps[turn.stepIndex]?.stage ?? steps[0].stage,
      step: steps[turn.stepIndex]?.name ?? translate(locale, 'coach.heading'),
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

export function sanitizeFilename(title: string, extension = 'md', locale: Locale = 'zh-CN') {
  const base = title
    .trim()
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .split('')
    .filter((character) => character.charCodeAt(0) > 31 && character.charCodeAt(0) !== 127)
    .join('')
    .slice(0, 120)
    .trim() || translate(locale, 'common.untitled')
  return `${base} - ${translate(locale, 'common.productName')}.${extension.replace(/^\./, '')}`
}

export function generateReadingMarkdown(model: ReadingExportModel) {
  const t = (key: string, variables?: Record<string, string | number>) => translate(model.locale, key, variables)
  const lines = [
    '---',
    `export_version: ${model.exportVersion}`,
    `title: ${yamlString(model.title)}`,
    `subtitle: ${yamlString(model.metadata.subtitle)}`,
    `author: ${yamlString(model.metadata.author)}`,
    `source: ${yamlString(model.metadata.source)}`,
    `pre_reading_prediction: ${yamlString(model.preReadingPrediction)}`,
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
    `- ${t('export.pdfStatus')}：${model.status === 'completed' ? t('export.statusCompleted') : model.status === 'in-progress' ? t('export.statusInProgress') : t('export.statusUnread')}`,
    `- ${t('export.completedRounds')}：${model.progress.completed} / ${model.progress.total}`,
    `- ${t('export.averageScore')}：${model.averageScore === null ? t('export.notScored') : `${model.averageScore} / 100`}`,
    ...(model.metadata.subtitle ? [`- ${t('export.subtitle')}：${escapeMarkdownBlock(model.metadata.subtitle)}`] : []),
    ...(model.metadata.author ? [`- ${t('export.author')}：${escapeMarkdownBlock(model.metadata.author)}`] : []),
    ...(model.metadata.source ? [`- ${t('export.source')}：${escapeMarkdownBlock(model.metadata.source)}`] : []),
    ...(model.url ? [`- ${t('export.url')}：${escapeMarkdownBlock(model.url)}`] : []),
    '',
    ...(model.preReadingPrediction ? [`## ${t('export.prediction')}`, '', escapeMarkdownBlock(model.preReadingPrediction), ''] : []),
    `## ${t('export.sourceText')}`,
    '',
  ]

  const articleMarkdown = articleBlocksToMarkdown(model.articleBlocks)
  if (articleMarkdown) lines.push(articleMarkdown, '')
  lines.push(`## ${t('export.trainingRecord')}`, '')
  if (!model.turns.length) lines.push(t('export.noAnswer'), '')
  model.turns.forEach((turn) => {
    lines.push(
      `### ${t('export.round', { number: turn.number })} · ${turn.stage} · ${turn.step}`,
      '',
      `#### ${t('export.question')}`,
      '',
      escapeMarkdownBlock(turn.question) || t('export.noQuestion'),
      '',
      `#### ${t('export.myAnswer')}`,
      '',
      escapeMarkdownBlock(turn.answer) || t('export.noRecordedAnswer'),
      '',
      ...feedbackMarkdown(turn.feedback, model.locale),
      '',
    )
  })
  if (model.draft) lines.push(`## ${t('export.draft')}`, '', escapeMarkdownBlock(model.draft), '')
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()}\n`
}

export function generateReadingPdfHtml(model: ReadingExportModel) {
  const t = (key: string, variables?: Record<string, string | number>) => translate(model.locale, key, variables)
  const paragraphs = articleBlocksToHtml(model.articleBlocks)
  const turns = model.turns.length
    ? model.turns.map((turn) => `<article class="turn"><h3>${escapeHtml(t('export.round', { number: turn.number }))} · ${escapeHtml(turn.stage)} · ${escapeHtml(turn.step)}</h3><h4>${escapeHtml(t('export.question'))}</h4>${htmlParagraphs(turn.question, t('export.notProvided'))}<h4>${escapeHtml(t('export.myAnswer'))}</h4>${htmlParagraphs(turn.answer, t('export.notProvided'))}${feedbackHtml(turn.feedback, model.locale)}</article>`).join('')
    : `<p>${escapeHtml(t('export.noAnswer'))}</p>`
  const subtitle = model.metadata.subtitle ? `<p class="subtitle">${escapeHtml(model.metadata.subtitle)}</p>` : ''
  const prediction = model.preReadingPrediction ? `<section class="prediction"><h2>${escapeHtml(t('export.prediction'))}</h2>${htmlParagraphs(model.preReadingPrediction, t('export.notProvided'))}</section>` : ''
  const status = model.status === 'completed' ? t('export.statusCompleted') : model.status === 'in-progress' ? t('export.statusInProgress') : t('export.statusUnread')
  const average = model.averageScore === null ? t('export.notScored') : `${model.averageScore} / 100`
  return `<!doctype html><html lang="${escapeHtml(model.locale)}"><head><meta charset="UTF-8"><title>${escapeHtml(model.title)} - ${escapeHtml(t('common.productName'))}</title><style>*{box-sizing:border-box}body{margin:0;background:#fffefa;color:#3f4e3b;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans SC",sans-serif;line-height:1.75}.toolbar{display:flex;justify-content:space-between;max-width:920px;margin:0 auto;padding:20px 28px;border-bottom:1px solid #dfe7d5;color:#809274;font-size:13px}.toolbar button{border:0;border-radius:6px;background:#728c5c;color:#fffefa;padding:9px 14px;font:inherit;cursor:pointer}.report{max-width:920px;margin:0 auto;padding:38px 28px 60px}.report h1,.report h2,.report h3{font-family:Georgia,"Songti SC","Noto Serif SC",serif;font-weight:500;color:#526b47}.report h1{font-size:32px;margin:0 0 4px}.report h2{font-size:22px;margin:36px 0 13px;border-bottom:1px solid #e4eadb;padding-bottom:8px}.report h3{font-size:17px;margin:28px 0 12px}.report h4{font-size:12px;color:#768d66;margin:18px 0 5px}.meta,.subtitle{color:#8a9a7f;font-size:12px}.prediction{background:#fafbf5;border:1px solid #e1e9d7;padding:18px 22px}.prediction p{margin:0;color:#65775e}.source{background:#fafbf5;border:1px solid #e1e9d7;padding:20px 22px}.source-paragraph{position:relative;padding-left:34px;margin:0 0 22px;font-family:Georgia,"Songti SC","Noto Serif SC",serif;font-size:15px;line-height:2.05;white-space:pre-wrap}.source-paragraph span{position:absolute;left:0;top:5px;color:#aab79d;font:10px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}.turn{border:1px solid #e1e9d7;border-radius:8px;padding:18px 20px;margin:16px 0;break-inside:avoid}.feedback{border-top:1px dashed #d7e2ca;margin-top:18px;padding-top:8px}.dimensions{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;padding:0;list-style:none}.dimensions li{background:#f1f5ea;border-radius:5px;padding:8px 10px}.dimensions strong{color:#698257}.dimensions span{float:right;color:#7b9368}.dimensions p,.feedback p{margin:3px 0;font-size:12px;color:#64745d}.feedback ul{padding-left:22px}.feedback blockquote{margin:5px 0;padding-left:10px;border-left:2px solid #c7d5b5;color:#65775e}.note{margin-top:24px;color:#a2af98;font-size:11px}@media print{.toolbar{display:none}.report{max-width:none;padding:0}.prediction,.source,.turn{break-inside:auto}}@media(max-width:700px){.toolbar,.report{padding-left:18px;padding-right:18px}.report h1{font-size:26px}.dimensions{grid-template-columns:1fr}}</style></head><body><div class="toolbar"><span>${escapeHtml(t('export.pdfToolbar', { completed: model.progress.completed, total: model.progress.total }))}</span><button type="button" onclick="window.print()">${escapeHtml(t('export.pdfSave'))}</button></div><main class="report"><h1>${escapeHtml(model.title)}</h1>${subtitle}<p class="meta">${escapeHtml(t('export.pdfStatus'))}：${escapeHtml(status)} · ${escapeHtml(t('export.pdfAverage'))}：${escapeHtml(average)}</p>${prediction}<h2>${escapeHtml(t('export.sourceText'))}</h2><section class="source">${paragraphs || `<p>${escapeHtml(t('export.pdfEmptySource'))}</p>`}</section><h2>${escapeHtml(t('export.trainingRecord'))}</h2>${turns}${model.draft ? `<h2>${escapeHtml(t('export.draft'))}</h2>${htmlParagraphs(model.draft, t('export.notProvided'))}` : ''}<p class="note">${escapeHtml(t('export.pdfNote'))}</p></main><script>window.addEventListener('load',()=>setTimeout(()=>window.print(),120));</script></body></html>`
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

function articleBlocksToHtml(blocks: ArticleBlock[]) {
  let sourceNumber = 0
  const number = () => String(++sourceNumber).padStart(2, '0')
  return blocks.map((block) => {
    if (block.type === 'paragraph') return `<p class="source-paragraph"><span>${number()}</span>${escapeHtml(block.text)}</p>`
    if (block.type === 'heading') return `<h${block.level} class="source-heading"><span>${number()}</span>${escapeHtml(block.text)}</h${block.level}>`
    if (block.type === 'quote') return `<blockquote class="source-quote"><span>${number()}</span>${escapeHtml(block.text)}</blockquote>`
    if (block.type === 'list') {
      const tag = block.ordered ? 'ol' : 'ul'
      return `<${tag} class="source-list">${block.items.map((item) => `<li><span>${number()}</span>${escapeHtml(item)}</li>`).join('')}</${tag}>`
    }
    if (block.type === 'code') return `<pre class="source-code"><code>${escapeHtml(block.text)}</code></pre>`
    if (block.type === 'image') return `<figure class="source-image"><img src="${escapeHtml(block.src)}" alt="${escapeHtml(block.alt)}" />${block.alt ? `<figcaption>${escapeHtml(block.alt)}</figcaption>` : ''}</figure>`
    return '<hr />'
  }).join('')
}

function averageScore(turns: TrainingSession['turns']) {
  const scores = turns.map((turn) => turn.feedback?.total).filter((score): score is number => score !== undefined)
  return scores.length ? Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : null
}

function feedbackMarkdown(feedback: NonNullable<TrainingSession['turns'][number]['feedback']> | null, locale: Locale) {
  const t = (key: string, variables?: Record<string, string | number>) => translate(locale, key, variables)
  if (!feedback) return [t('export.notScored')]
  const dimensions = [
    ['fidelity', t('feedback.fidelity')],
    ['claim', t('feedback.claim')],
    ['cause', t('feedback.cause')],
    ['structure', t('feedback.structure')],
  ] as const
  const lines = [`#### ${t('export.feedback')}`, '']
  dimensions.forEach(([key, label]) => {
    const dimension = feedback.dimensions[key as keyof typeof feedback.dimensions]
    lines.push(`- ${label}：${dimension.score === null ? t('export.notMeasured') : `${dimension.score} / 10`}`)
  })
  appendObservations(lines, t('export.strengths'), feedback.strengths, t('export.noStrengths'))
  appendObservations(lines, t('export.gaps'), feedback.gaps, t('export.noGaps'))
  lines.push('', `#### ${t('export.sourceEvidence')}`, '')
  feedback.sources.forEach((source) => {
    lines.push(`- ${t('feedback.paragraph', { number: source.paragraph })} ${blockquote(source.quote).replace(/\n/g, '\n  ')}`)
    lines.push(`  ${escapeMarkdownBlock(source.comment)}`)
  })
  lines.push('', `#### ${t('export.nextQuestion')}`, '', escapeMarkdownBlock(feedback.nextQuestion))
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

function feedbackHtml(feedback: NonNullable<TrainingSession['turns'][number]['feedback']> | null, locale: Locale) {
  const t = (key: string, variables?: Record<string, string | number>) => translate(locale, key, variables)
  if (!feedback) return `<p>${escapeHtml(t('export.notScored'))}</p>`
  const dimensions = [
    ['fidelity', t('feedback.fidelity')],
    ['claim', t('feedback.claim')],
    ['cause', t('feedback.cause')],
    ['structure', t('feedback.structure')],
  ] as const
  const dimensionHtml = dimensions.map(([key, label]) => {
    const dimension = feedback.dimensions[key as keyof typeof feedback.dimensions]
    return `<li><strong>${escapeHtml(label)}</strong><span>${escapeHtml(dimension.score === null ? t('export.notMeasured') : `${dimension.score} / 10`)}</span><p>${escapeHtml(dimension.reason)}</p></li>`
  }).join('')
  const observations = (items: Array<{ answerQuote: string; comment: string }>, empty: string) => items.length
    ? `<ul>${items.map((item) => `<li>${item.answerQuote ? `<blockquote>${htmlParagraphs(item.answerQuote, t('export.notProvided'))}</blockquote>` : ''}<p>${htmlParagraphs(item.comment, t('export.notProvided'))}</p></li>`).join('')}</ul>`
    : `<p>${escapeHtml(empty)}</p>`
  const sources = `<ul>${feedback.sources.map((source) => `<li><strong>${escapeHtml(t('feedback.paragraph', { number: source.paragraph }))}</strong><blockquote>${htmlParagraphs(source.quote, t('export.notProvided'))}</blockquote><p>${htmlParagraphs(source.comment, t('export.notProvided'))}</p></li>`).join('')}</ul>`
  return `<section class="feedback"><h4>${escapeHtml(t('export.feedback'))}</h4><ul class="dimensions">${dimensionHtml}</ul><h4>${escapeHtml(t('export.strengths'))}</h4>${observations(feedback.strengths, t('export.noStrengths'))}<h4>${escapeHtml(t('export.gaps'))}</h4>${observations(feedback.gaps, t('export.noGaps'))}<h4>${escapeHtml(t('export.sourceEvidence'))}</h4>${sources}<h4>${escapeHtml(t('export.nextQuestion'))}</h4>${htmlParagraphs(feedback.nextQuestion, t('export.notProvided'))}</section>`
}

function splitArticle(article: string) {
  return article.split(/\n\s*\n/).map((paragraph) => paragraph.trim()).filter(Boolean)
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

function htmlParagraphs(value: string, empty: string) {
  return value.split(/\n+/).map((line) => line.trim()).filter(Boolean).map((line) => `<p>${escapeHtml(line)}</p>`).join('') || `<p>${escapeHtml(empty)}</p>`
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
