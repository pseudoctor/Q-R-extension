import assert from 'node:assert/strict'
import { articleBlocksFromText, articleBlocksToText } from '../src/articles/format.ts'

const source = '第一段第一行。\n第一段第二行。\n\n第二段第一行。\n第二段第二行。'
const blocks = articleBlocksFromText(source)

assert.equal(blocks.length, 2)
assert.equal(blocks[0].text, '第一段第一行。\n第一段第二行。')
assert.equal(blocks[1].text, '第二段第一行。\n第二段第二行。')
assert.equal(articleBlocksToText(blocks), source)

console.log('PASS: paragraph boundaries preserve intra-paragraph line breaks and blank-line separators.')
