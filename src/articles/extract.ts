import type { ArticleBlock, ArticleInline, ErrorCode } from '../types'

export type PageExtraction = {
  title: string
  url: string
  author?: string
  text: string
  blocks?: ArticleBlock[]
  selectedText?: string
  error?: {
    code: ErrorCode
    message: string
  }
}

export function extractArticleFromPage(): PageExtraction {
  const minSelectedTextLength = 40
  const minArticleTextLength = 120
  const maxArticleTextLength = 36_000
  const structured = readStructuredData()
  const normalize = (value: string) =>
    value
      .replace(/\u00a0/g, ' ')
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/)
      .map((paragraph) => paragraph.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').trim())
      .filter(Boolean)
      .join('\n\n')
      .slice(0, maxArticleTextLength)

  const metaContent = (selector: string) => document.querySelector(selector)?.getAttribute('content')?.trim() ?? ''
  const title = document.title.trim() || metaContent('meta[property="og:title"]') || structured.title || '未命名文章'
  const url = window.location.href
  const author = metaContent('meta[name="author"], meta[property="article:author"]') || structured.author
  const selectedText = normalize(window.getSelection()?.toString() ?? '')

  if (selectedText.length >= minSelectedTextLength) {
    const blocks = limitBlocks(textToBlocks(selectedText))
    return {
      title,
      url,
      ...(author ? { author } : {}),
      text: blocksToText(blocks),
      blocks,
      selectedText,
    }
  }

  const selectors: Array<[string, number]> = [
    ['#rm_txt_zw', 14_000],
    ['[itemprop="articleBody"]', 12_000],
    ['article', 10_000],
    ['.article-content, .article-body, .post-content, .entry-content, .article__content, .story-body', 7_000],
    ['main, [role="main"]', 5_000],
    ['#article, #content, #main-content, .content', 3_000],
    ['body', 0],
  ]
  const candidates = new Map<HTMLElement, number>()
  for (const [selector, weight] of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((element) => {
      candidates.set(element, Math.max(weight, candidates.get(element) ?? 0))
    })
  }
  const structuralElements = Array.from(document.querySelectorAll<HTMLElement>('div, section'))
  const structuralSet = new Set(structuralElements)
  const structuralRoots = structuralElements.filter((element) => {
    const ancestor = element.parentElement?.closest('div, section') as HTMLElement | null | undefined
    return !ancestor || !structuralSet.has(ancestor)
  }).slice(0, 64)
  structuralRoots.forEach((element) => {
    const longParagraphCount = Array.from(element.querySelectorAll('p'))
      .filter((paragraph) => normalize(paragraph.innerText).length >= 40)
      .length
    if (longParagraphCount >= 2) candidates.set(element, Math.max(900, candidates.get(element) ?? 0))
  })

  let bestText = ''
  let bestBlocks: ArticleBlock[] = []
  let bestScore = Number.NEGATIVE_INFINITY
  for (const [candidate, weight] of candidates) {
    const clone = cleanClone(candidate)
    const blocks = extractBlocks(clone)
    const text = blocksToText(blocks) || normalize(clone.innerText)
    if (!text) continue
    const paragraphs = Array.from(clone.querySelectorAll('p'))
    const paragraphTextLength = paragraphs.reduce((total, paragraph) => total + normalize(paragraph.innerText).length, 0)
    const paragraphCount = paragraphs.filter((paragraph) => normalize(paragraph.innerText).length >= 40).length
    const sentenceCount = (text.match(/[。！？.!?]/g) ?? []).length
    const linkTextLength = Array.from(clone.querySelectorAll('a'))
      .reduce((total, link) => total + normalize(link.textContent ?? '').length, 0)
    const linkPenalty = Math.min(text.length, linkTextLength) * 1.4
    const nonParagraphTextLength = paragraphTextLength > 0 ? Math.max(0, text.length - paragraphTextLength) : 0
    const nonParagraphPenalty = nonParagraphTextLength * 1.2
    const paragraphDensity = paragraphTextLength / Math.max(text.length, 1)
    const score = weight + Math.min(paragraphTextLength || text.length, 24_000) + paragraphCount * 160 + sentenceCount * 8
      + paragraphDensity * 1_500 - linkPenalty - nonParagraphPenalty
    if (score > bestScore) {
      bestScore = score
      bestText = text
      bestBlocks = blocks
    }
  }

  const structuredText = normalize(structured.articleBody)
  const useStructuredText = structuredText.length >= minArticleTextLength && structuredText.length > bestText.length
  const text = useStructuredText ? structuredText : bestText
  const blocks = limitBlocks(useStructuredText
    ? preserveVisuals(textToBlocks(structuredText), bestBlocks)
    : bestBlocks)
  const normalizedText = blocksToText(blocks) || text.slice(0, maxArticleTextLength)

  if (normalizedText.length < minArticleTextLength) {
    return {
      title,
      url,
      ...(author ? { author } : {}),
      text: normalizedText,
      blocks,
      error: {
        code: 'ARTICLE_TOO_SHORT',
        message: '没有识别到足够长的正文，请先选择正文后重试，或在训练页手动粘贴文章。',
      },
    }
  }

  return {
    title,
    url,
    ...(author ? { author } : {}),
    text: normalizedText,
    blocks,
  }

  function textToBlocks(value: string): ArticleBlock[] {
    return value
      .replace(/\r\n?/g, '\n')
      .split(/\n\s*\n/)
      .map((text) => text.split('\n').map((line) => line.replace(/[ \t]+/g, ' ').trim()).filter(Boolean).join('\n').trim())
      .filter(Boolean)
      .map((text) => ({ type: 'paragraph', text }))
  }

  function blocksToText(blocks: ArticleBlock[]) {
    return blocks.flatMap((block) => {
      if (block.type === 'list') return [block.items.join('\n')]
      if (block.type === 'image') return block.alt ? [block.alt] : []
      if (block.type === 'chart') return [block.text]
      if (block.type === 'divider') return []
      return [block.text]
    }).join('\n\n').trim().slice(0, maxArticleTextLength)
  }

  function limitBlocks(blocks: ArticleBlock[]): ArticleBlock[] {
    let remaining = maxArticleTextLength
    const limited: ArticleBlock[] = []
    for (const block of blocks) {
      if (remaining <= 0) break
      if (block.type === 'image' || block.type === 'chart' || block.type === 'divider') {
        limited.push(block)
        continue
      }
      if (block.type === 'list') {
        const items: string[] = []
        for (const item of block.items) {
          if (remaining <= 0) break
          const value = item.slice(0, remaining)
          if (value) {
            items.push(value)
            remaining -= value.length
          }
        }
        if (items.length) limited.push({ ...block, items })
        continue
      }
      const text = block.text.slice(0, remaining)
      if (!text) break
      limited.push({ ...block, text })
      remaining -= text.length
    }
    return limited
  }

  function preserveVisuals(blocks: ArticleBlock[], fallbackBlocks: ArticleBlock[]) {
    const visuals = fallbackBlocks.filter((block) => block.type === 'image' || block.type === 'chart')
    if (!visuals.length) return blocks
    const preserved = [...blocks]
    for (const visual of visuals) {
      const visualText = visual.type === 'image' ? visual.alt : visual.text
      const captionIndex = visualText
        ? preserved.findIndex((block) => 'text' in block && block.text.includes(visualText))
        : -1
      if (captionIndex >= 0) preserved.splice(captionIndex, 0, visual)
      else preserved.push(visual)
    }
    return preserved
  }

  function extractBlocks(root: HTMLElement): ArticleBlock[] {
    const blocks: ArticleBlock[] = []
    const addText = (type: 'paragraph' | 'heading' | 'quote', value: string, level?: number) => {
      const text = value.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').split(/\n+/).map((line) => line.trim()).filter(Boolean).join(type === 'quote' ? '\n' : ' ').trim()
      if (!text) return
      if (type === 'heading') blocks.push({ type, level: level ?? 2, text })
      else blocks.push({ type, text })
    }
    const addInlineText = (type: 'paragraph' | 'heading' | 'quote', element: Element, level?: number) => {
      const inlines = readInlineSegments(element, type === 'quote')
      const text = inlines.map((inline) => inline.text).join('').trim()
      if (!text) return
      if (type === 'heading') blocks.push({ type, level: level ?? 2, text, inlines })
      else blocks.push({ type, text, inlines })
    }
    const addChart = (chart: Element, figure?: Element) => {
      const descriptions = [
        chart.getAttribute('aria-label'),
        chart.getAttribute('title'),
        chart.querySelector('title')?.textContent,
        figure?.querySelector('figcaption')?.textContent,
        chart.tagName.toLowerCase() === 'svg' ? chart.textContent : '',
      ]
        .map((value) => (value ?? '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index)
      const text = (descriptions.join('；') || '原文提供图表，但未提供可读取的图表说明。').slice(0, 600)
      blocks.push({ type: 'chart', text, alt: descriptions[0] ?? '原文图表' })
    }
    const visit = (element: Element) => {
      const tag = element.tagName.toLowerCase()
      if (/^h[1-6]$/.test(tag)) {
        addInlineText('heading', element, Number(tag.slice(1)))
        return
      }
      if (tag === 'p') {
        addInlineText('paragraph', element)
        return
      }
      if (tag === 'blockquote') {
        addInlineText('quote', element)
        return
      }
      if (tag === 'svg' || tag === 'canvas') {
        addChart(element)
        return
      }
      if (tag === 'pre') {
        const text = (element.textContent ?? '').replace(/\r\n?/g, '\n').trim()
        if (text) {
          const code = element.querySelector('code')
          const language = Array.from(code?.classList ?? []).find((name) => name.startsWith('language-'))?.slice(9)
          blocks.push({ type: 'code', ...(language ? { language } : {}), text })
        }
        return
      }
      if (tag === 'ul' || tag === 'ol') {
        const itemElements = Array.from(element.children)
          .filter((child) => child.tagName.toLowerCase() === 'li')
        const listItems = itemElements.map((item) => {
            const clone = item.cloneNode(true) as HTMLElement
            clone.querySelectorAll('ul, ol').forEach((nested) => nested.remove())
            return {
              text: (clone.textContent ?? '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').trim(),
              inlines: readInlineSegments(clone, false),
            }
          })
        const items = listItems.filter((item) => item.text)
        const itemInlines = items.map((item) => item.inlines)
        if (items.length) blocks.push({ type: 'list', ordered: tag === 'ol', items: items.map((item) => item.text), itemInlines })
        return
      }
      if (tag === 'figure') {
        const chart = element.querySelector('svg, canvas')
        if (chart) {
          addChart(chart, element)
          return
        }
        const image = element.querySelector('img')
        if (image) visit(image)
        const caption = element.querySelector('figcaption')
        if (caption) addText('paragraph', caption.textContent ?? '')
        return
      }
      if (tag === 'img') {
        const rawSrc = (element as HTMLImageElement).currentSrc || (element as HTMLImageElement).src
        try {
          const url = new URL(rawSrc, window.location.href)
          if (isAllowedImageSource(url)) {
            blocks.push({ type: 'image', src: url.href, alt: (element.getAttribute('alt') ?? '').trim() })
          }
        } catch {
          return
        }
        return
      }
      if (tag === 'hr') {
        blocks.push({ type: 'divider' })
        return
      }
      const children = Array.from(element.children)
      const hasBlockChildren = children.some((child) => /^(article|blockquote|div|figure|h[1-6]|li|main|ol|p|pre|section|ul|hr)$/i.test(child.tagName))
      if (!children.length || !hasBlockChildren) {
        addInlineText('paragraph', element)
        return
      }
      children.forEach(visit)
    }
    visit(root)
    return blocks

    function readInlineSegments(element: Element, preserveNewlines: boolean): ArticleInline[] {
      const segments: ArticleInline[] = []
      const visitNode = (node: Node, emphasis?: ArticleInline['emphasis']) => {
        if (node.nodeType === Node.TEXT_NODE) {
          const text = (node.textContent ?? '')
            .replace(/\u00a0/g, ' ')
            .replace(preserveNewlines ? /[ \t]+/g : /\s+/g, ' ')
          if (!text) return
          const previous = segments.at(-1)
          if (previous && previous.emphasis === emphasis) previous.text += text
          else segments.push({ text, ...(emphasis ? { emphasis } : {}) })
          return
        }
        if (node.nodeType !== Node.ELEMENT_NODE) return
        const child = node as Element
        const tag = child.tagName.toLowerCase()
        if (tag === 'br') {
          const previous = segments.at(-1)
          if (previous && previous.emphasis === emphasis) previous.text += '\n'
          else segments.push({ text: '\n', ...(emphasis ? { emphasis } : {}) })
          return
        }
        const isStrong = tag === 'strong' || tag === 'b'
        const isEmphasis = tag === 'em' || tag === 'i'
        const nextEmphasis = isStrong && isEmphasis
          ? 'strong-emphasis'
          : isStrong
            ? emphasis === 'emphasis' ? 'strong-emphasis' : 'strong'
            : isEmphasis
              ? emphasis === 'strong' ? 'strong-emphasis' : 'emphasis'
              : emphasis
        child.childNodes.forEach((childNode) => visitNode(childNode, nextEmphasis))
      }
      element.childNodes.forEach((child) => visitNode(child))
      const normalized = segments
        .map((segment) => ({ ...segment, text: segment.text.replace(preserveNewlines ? /[ \t]+/g : /\s+/g, ' ') }))
        .filter((segment) => segment.text)
      const joined = normalized.map((segment) => segment.text).join('').trim()
      if (!joined) return []
      let remaining = joined
      return normalized.flatMap((segment) => {
        const text = segment.text.slice(Math.max(0, segment.text.length - remaining.length))
        remaining = remaining.slice(text.length)
        return text ? [{ ...segment, text }] : []
      })
    }

    function isAllowedImageSource(url: URL) {
      return (url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password
    }
  }

  function cleanClone(element: HTMLElement) {
    const clone = element.cloneNode(true) as HTMLElement
    clone.querySelectorAll([
      'script', 'style', 'noscript', 'nav', 'aside', 'footer', 'form', 'header', 'button',
      'iframe', 'video', 'audio', '[aria-hidden="true"]', '[role="navigation"]',
      '[role="complementary"]', '[role="contentinfo"]',
      '[id*="nav" i]', '[class*="nav" i]', '[id*="header" i]', '[class*="header" i]',
      '[id*="footer" i]', '[class*="footer" i]', '[id*="breadcrumb" i]', '[class*="breadcrumb" i]',
      '.ad', '.ads', '.advertisement', '.advert', '.sidebar', '.comments', '.comment',
      '.related', '.share', '.social', '.newsletter', '.cookie', 'ins',
      '[data-testid*="ad" i]', '[aria-label*="advertisement" i]', '[class*="audio" i]', '[class*="listen" i]',
    ].join(',')).forEach((element) => element.remove())
    clone.querySelectorAll<HTMLElement>('div, section').forEach((element) => {
      if (element === clone) return
      const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
      const isAdvertisement = /^advertisement$/i.test(text)
      const isAudioPlayer = text.length < 320 && /narrated by/i.test(text) && /\d{1,2}:\d{2}/.test(text)
      if (isAdvertisement || isAudioPlayer) element.remove()
    })
    return clone
  }

  function readStructuredData() {
    let result = { title: '', author: '', articleBody: '' }
    for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
      try {
        const parsed: unknown = JSON.parse(script.textContent ?? '')
        const entries = Array.isArray(parsed) ? parsed : [parsed]
        for (const entry of entries) {
          if (!isObject(entry)) continue
          const graph = Array.isArray(entry['@graph']) ? entry['@graph'] : [entry]
          for (const item of graph) {
            if (!isObject(item)) continue
            const articleBody = typeof item.articleBody === 'string' ? item.articleBody : ''
            const headline = typeof item.headline === 'string' ? item.headline : ''
            const rawAuthor = item.author
            const structuredAuthor = typeof rawAuthor === 'string'
              ? rawAuthor
              : isObject(rawAuthor) && typeof rawAuthor.name === 'string' ? rawAuthor.name : ''
            if (articleBody.length > result.articleBody.length) result = { ...result, articleBody }
            if (!result.title && headline) result = { ...result, title: headline }
            if (!result.author && structuredAuthor) result = { ...result, author: structuredAuthor }
          }
        }
      } catch {
        continue
      }
    }
    return result
  }

  function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
  }
}

