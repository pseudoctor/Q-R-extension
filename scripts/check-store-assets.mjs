import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const storeAssets = resolve(root, 'store-assets')
const locales = ['en', 'zh']
const screenshotNames = [
  '01-import-prediction',
  '02-guided-question',
  '03-three-sentence',
  '04-ai-feedback',
  '05-library-growth',
]
const allowedExtensions = ['.jpg', '.jpeg', '.png']
const screenshotSizes = new Set(['1280x800', '640x400'])

if (!existsSync(storeAssets)) throw new Error('缺少商店素材目录：store-assets')

function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? listFiles(path) : [path]
  })
}

function readPngInfo(buffer, path) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (buffer.length < 26 || !buffer.subarray(0, 8).equals(signature)) return null
  const bitDepth = buffer[24]
  const colorType = buffer[25]
  if (bitDepth !== 8 || colorType !== 2) {
    throw new Error(`${relative(root, path)} 必须是 24-bit RGB PNG（不含 alpha 通道）。`)
  }
  return { format: 'png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function readJpegInfo(buffer, path) {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null
  let offset = 2
  while (offset < buffer.length) {
    while (buffer[offset] === 0xff) offset += 1
    const marker = buffer[offset]
    offset += 1
    if (marker === 0xd9 || marker === 0xda) break
    if (marker >= 0xd0 && marker <= 0xd7) continue
    if (offset + 2 > buffer.length) break
    const segmentLength = buffer.readUInt16BE(offset)
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)
    if (isStartOfFrame) {
      return {
        format: 'jpeg',
        width: buffer.readUInt16BE(offset + 5),
        height: buffer.readUInt16BE(offset + 3),
      }
    }
    offset += segmentLength
  }
  throw new Error(`无法读取 JPEG 尺寸：${relative(root, path)}`)
}

function readImageInfo(path) {
  const buffer = readFileSync(path)
  return readPngInfo(buffer, path) ?? readJpegInfo(buffer, path) ?? (() => {
    throw new Error(`不是受支持的 JPEG 或 24-bit RGB PNG：${relative(root, path)}`)
  })()
}

function findAsset(basePath) {
  const matches = allowedExtensions.map((extension) => `${basePath}${extension}`).filter((path) => existsSync(path))
  if (matches.length !== 1) {
    throw new Error(`素材必须且只能有一个文件：${relative(root, basePath)}.[jpg|jpeg|png]`)
  }
  return matches[0]
}

function assertSize(path, expectedSizes) {
  const info = readImageInfo(path)
  const actualSize = `${info.width}x${info.height}`
  if (!expectedSizes.has(actualSize)) {
    throw new Error(`${relative(root, path)} 尺寸为 ${actualSize}，要求为 ${[...expectedSizes].join(' 或 ')}。`)
  }
}

const expectedFiles = new Set()
for (const locale of locales) {
  for (const screenshot of screenshotNames) {
    const path = findAsset(resolve(storeAssets, locale, 'screenshots', screenshot))
    expectedFiles.add(relative(storeAssets, path))
    assertSize(path, screenshotSizes)
  }
  const small = findAsset(resolve(storeAssets, locale, 'promo', 'small'))
  const marquee = findAsset(resolve(storeAssets, locale, 'promo', 'marquee'))
  expectedFiles.add(relative(storeAssets, small))
  expectedFiles.add(relative(storeAssets, marquee))
  assertSize(small, new Set(['440x280']))
  assertSize(marquee, new Set(['1400x560']))
}

const unexpectedFinalFiles = listFiles(storeAssets)
  .map((path) => relative(storeAssets, path))
  .filter((path) => !path.startsWith('drafts/') && !path.endsWith('.DS_Store') && !path.includes('-source.'))
  .filter((path) => !expectedFiles.has(path))

if (unexpectedFinalFiles.length > 0) {
  throw new Error(`发现未纳入清单的最终商店素材：${unexpectedFinalFiles.join(', ')}`)
}

console.log(`Store assets are valid: ${expectedFiles.size} final assets across ${locales.length} locales.`)
