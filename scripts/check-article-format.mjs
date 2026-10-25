import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { articleBlocksFromText, articleBlocksToText, normalizeArticleBlocks, numberArticleBlocks } from '../src/articles/format.ts'

const server = await createServer({ root: new URL('..', import.meta.url).pathname, logLevel: 'silent' })
const { buildGradePrompt, validateAiFeedback } = await server.ssrLoadModule('/src/ai/coach.ts')

const source = '第一段第一行。\n第一段第二行。\n\n第二段第一行。\n第二段第二行。'
const blocks = articleBlocksFromText(source)

assert.equal(blocks.length, 2)
assert.equal(blocks[0].text, '第一段第一行。\n第一段第二行。')
assert.equal(blocks[1].text, '第二段第一行。\n第二段第二行。')
assert.equal(articleBlocksToText(blocks), source)

assert.deepEqual(
  normalizeArticleBlocks([
    { type: 'image', src: 'https://images.example.com/article.jpg', alt: '文章图片' },
  ]),
  [{ type: 'image', src: 'https://images.example.com/article.jpg', alt: '文章图片' }],
)
assert.deepEqual(
  normalizeArticleBlocks([{ type: 'image', src: 'http://images.example.com/article.jpg', alt: '' }]),
  [{ type: 'image', src: 'http://images.example.com/article.jpg', alt: '' }],
)
assert.deepEqual(normalizeArticleBlocks([{ type: 'image', src: 'https://user:pass@images.example.com/article.jpg', alt: '' }]), [])
assert.deepEqual(
  normalizeArticleBlocks([{
    type: 'paragraph',
    text: '普通重点',
    inlines: [{ text: '普通', emphasis: 'strong' }, { text: '重点', emphasis: 'emphasis' }],
  }, {
    type: 'chart',
    text: '销售额：第一季度上升',
    alt: '季度销售额图表',
  }]),
  [{
    type: 'paragraph',
    text: '普通重点',
    inlines: [{ text: '普通', emphasis: 'strong' }, { text: '重点', emphasis: 'emphasis' }],
  }, {
    type: 'chart',
    text: '销售额：第一季度上升',
    alt: '季度销售额图表',
  }],
)

assert.deepEqual(
  numberArticleBlocks([
    { type: 'paragraph', text: '开头背景' },
    { type: 'heading', level: 2, text: '主体流程' },
    { type: 'list', ordered: false, items: ['第一步', '第二步'] },
    { type: 'image', src: 'https://images.example.com/article.jpg', alt: '' },
    { type: 'paragraph', text: '结尾说明' },
  ]),
  [
    { paragraph: 1, text: '开头背景', blockIndex: 0 },
    { paragraph: 2, text: '结尾说明', blockIndex: 4 },
  ],
)

const numberedBlocks = [
  { type: 'paragraph', text: '开头背景' },
  { type: 'heading', level: 2, text: '主体流程' },
  { type: 'list', ordered: false, items: ['第一步', '第二步'] },
  { type: 'image', src: 'https://images.example.com/article.jpg', alt: '' },
  { type: 'paragraph', text: '结尾说明' },
]
const session = {
  articleId: 'article',
  currentStep: 1,
  currentQuestion: '当前问题？',
  draft: '学生回答内容',
  turns: [],
  startedAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}
const prompt = buildGradePrompt('不按空行分段的原文', '标题', { subtitle: '', author: '', source: '' }, session, '', 'zh-CN', numberedBlocks)
assert.deepEqual(JSON.parse(prompt.user).paragraphs, [
  { paragraph: 1, text: '开头背景' },
  { paragraph: 2, text: '结尾说明' },
])
assert.doesNotThrow(() => validateAiFeedback({
  dimensions: {
    fidelity: { score: 8, reason: '回答引用了原文。' },
    claim: { score: null, reason: '本题未测' },
    cause: { score: null, reason: '本题未测' },
    structure: { score: null, reason: '本题未测' },
  },
  strengths: [],
  gaps: [],
  sources: [{ paragraph: 2, quote: '结尾说明', comment: '这对应结尾说明。' }],
  nextQuestion: '请说明下一步如何判断？',
  nextStepId: 'feynman-review',
}, '不按空行分段的原文', '学生回答内容', numberedBlocks))

console.log('PASS: paragraph boundaries preserve intra-paragraph line breaks and blank-line separators.')
await server.close()
