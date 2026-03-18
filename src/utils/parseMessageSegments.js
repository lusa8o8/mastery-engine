/**
 * Parses an Atlas message string into segments.
 * Each segment is either:
 *   { type: 'text', content: string }         — rendered via dangerouslySetInnerHTML
 *   { type: 'venn', content: string }          — rendered as SVG Venn
 *   { type: 'mafs', content: string }          — rendered as Mafs function plot
 *   { type: 'chart', content: string }         — rendered as Recharts histogram
 *   { type: 'numberline', content: string }    — rendered as SVG number line
 */

const BLOCK_PATTERN = /```(venn|mafs|chart|numberline)\n([\s\S]*?)```/g

export function parseMessageSegments(text) {
  const segments = []
  let lastIndex = 0
  let match

  BLOCK_PATTERN.lastIndex = 0

  while ((match = BLOCK_PATTERN.exec(text)) !== null) {
    // Text before this block
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        content: text.slice(lastIndex, match.index)
      })
    }
    // The viz block
    segments.push({
      type: match[1],
      content: match[2].trim()
    })
    lastIndex = match.index + match[0].length
  }

  // Remaining text after last block
  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      content: text.slice(lastIndex)
    })
  }

  // If no blocks found, return entire text as one segment
  if (segments.length === 0) {
    segments.push({ type: 'text', content: text })
  }

  return segments
}
