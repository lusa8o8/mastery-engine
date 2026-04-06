function renderLatex(tex, displayMode) {
  try {
    return window.katex.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
      macros: {
        '\\R': '\\mathbb{R}',
        '\\Z': '\\mathbb{Z}',
        '\\N': '\\mathbb{N}',
        '\\Q': '\\mathbb{Q}',
      }
    })
  } catch {
    return tex
  }
}

export function renderMath(text) {
  if (!text) return text

  // Step 1: protect code blocks from math processing
  const codeBlocks = []
  let out = text.replace(/```[\s\S]*?```/g, function(match) {
    codeBlocks.push(match)
    return '%%MATHCODE_' + (codeBlocks.length - 1) + '%%'
  })

  // Step 2: render display math $$...$$ first
  out = out.replace(/\$\$([^$]+?)\$\$/gs, function(match, tex) {
    return renderLatex(tex.trim(), true)
  })

  // Step 3: render inline math $...$
  out = out.replace(/\$([^$\n]+?)\$/g, function(match, tex) {
    return renderLatex(tex.trim(), false)
  })

  // Step 4: render raw LaTeX expressions not wrapped in $
  // Matches \frac, \sqrt, \int, \sum, \prod, \lim etc.
  out = out.replace(/\\(frac|sqrt|int|sum|prod|lim|infty|alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|omega|partial|nabla|cdot|times|div|pm|leq|geq|neq|approx|equiv|in|notin|subset|subseteq|cup|cap|emptyset|forall|exists|rightarrow|leftarrow|leftrightarrow|Rightarrow|Leftarrow|overline|underline|hat|vec|bar|dot|ddot|text|mathbb|mathrm|mathbf)\b[\s\S]*?(?=[,.\s]|$)/g, function(match) {
    try {
      return renderLatex(match.trim(), false)
    } catch {
      return match
    }
  })

  // Step 5: restore code blocks
  out = out.replace(/%%MATHCODE_(\d+)%%/g, function(match, i) {
    return codeBlocks[parseInt(i)]
  })

  return out
}
