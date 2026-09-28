/**
 * Text featurisation for Solidity source.
 *
 * Design notes that matter:
 *  - comments and string literals are stripped first, so the model has to learn
 *    code structure instead of author fingerprints (or our own generator's
 *    comment wording).
 *  - identifiers are split on camelCase / snake_case then lowercased, so
 *    `_isExcludedFromFee` and `isExcludedFromFee` collapse to the same signals.
 *  - features are unigrams plus within-line bigrams. That captures the pattern
 *    `onlyOwner` + `set` + `fee` without needing a Solidity parser.
 */

const STOP = new Set([
  'a', 'an', 'as', 'abstract', 'abi', 'address', 'and', 'assembly', 'assert', 'block',
  'bool', 'bytes', 'bytes32', 'calldata', 'catch', 'constant', 'constructor',
  'contract', 'decode', 'delete', 'else', 'emit', 'encode', 'encodepacked', 'enum',
  'event', 'external', 'false', 'for', 'from', 'function', 'if', 'immutable',
  'import', 'indexed', 'interface', 'internal', 'is', 'keccak256', 'library',
  'license', 'mapping', 'memory', 'mit', 'modifier', 'msg', 'new', 'override',
  'payable', 'pragma', 'private', 'public', 'pure', 'require', 'return', 'returns',
  'revert', 'solidity', 'spdx', 'storage', 'string', 'struct', 'super', 'this',
  'true', 'try', 'tx', 'uint', 'uint160', 'uint256', 'uint48', 'uint8', 'unchecked',
  'using', 'view', 'virtual', 'while',
])

/** Removes comments and string literals, preserving offsets with spaces. */
export function stripCommentsAndStrings(src: string): string {
  const out = new Array<string>(src.length).fill(' ')
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++
      continue
    }
    if (c === '/' && n === '*') {
      i += 2
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++
      i += 2
      continue
    }
    if (c === '"' || c === "'") {
      const quote = c
      i++
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') i++
        i++
      }
      i++
      continue
    }
    out[i] = c
    i++
  }
  return out.join('')
}

/** Splits one identifier into its readable parts: `_isExcludedFromFee` -> is, excluded, from, fee */
export function splitIdentifier(raw: string): string[] {
  const trimmed = raw.replace(/^_+/, '')
  if (!trimmed) return []
  const spaced = trimmed
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
  return spaced
    .split(/[^A-Za-z0-9]+/)
    .map((p) => p.trim().toLowerCase())
    .filter((p) => p.length > 0)
}

export type TokenSpan = { start: number; end: number; text: string; parts: string[] }

/** Identifier occurrences in the original source, with offsets, skipping comments/strings. */
export function identifierSpans(src: string): TokenSpan[] {
  const clean = stripCommentsAndStrings(src)
  const spans: TokenSpan[] = []
  const re = /[A-Za-z_$][A-Za-z0-9_$]*/g
  let m: RegExpExecArray | null
  while ((m = re.exec(clean)) !== null) {
    const parts = splitIdentifier(m[0])
    if (parts.length === 0) continue
    spans.push({ start: m.index, end: m.index + m[0].length, text: m[0], parts })
  }
  return spans
}

function bucketNumber(raw: string): string {
  const n = Number(raw)
  if (!Number.isFinite(n)) return 'big'
  if (n === 0) return 'zero'
  if (n <= 10) return 'small'
  if (n <= 1000) return 'medium'
  if (n <= 1_000_000) return 'large'
  return 'huge'
}

/** Ordered token stream: unigrams with `num:` bucketing, plus within-line bigrams. */
export function tokenize(src: string): string[] {
  const clean = stripCommentsAndStrings(src)
  const tokens: string[] = []
  for (const line of clean.split('\n')) {
    // Numbers match first so `1_000_000_000` stays one literal instead of
    // decaying into `1` plus three `000` identifiers.
    const ids = line.match(/[A-Za-z_$][A-Za-z0-9_$]*|\d[\d_]*/g) ?? []
    const lineTokens: string[] = []
    for (const raw of ids) {
      if (/^\d/.test(raw)) {
        lineTokens.push(`num:${bucketNumber(raw.replace(/_/g, ''))}`)
        continue
      }
      for (const part of splitIdentifier(raw)) lineTokens.push(part)
    }
    for (let i = 0; i < lineTokens.length; i++) {
      tokens.push(lineTokens[i])
      if (i + 1 < lineTokens.length) tokens.push(`${lineTokens[i]}→${lineTokens[i + 1]}`)
    }
  }
  return tokens
}

export type SparseVector = Map<number, number>
export type VocabEntry = { index: number; df: number; idf: number; name: string }

/**
 * TF-IDF vectoriser: sublinear term frequency, smoothed inverse document
 * frequency, L2 normalisation, min document frequency and a vocabulary cap.
 */
export class TfidfVectorizer {
  vocabulary = new Map<string, VocabEntry>()
  featureNames: string[] = []
  idf: Float64Array = new Float64Array(0)
  minDf = 3
  maxFeatures = 8000
  private fitted = false

  fit(docs: string[][]): void {
    const df = new Map<string, number>()
    for (const doc of docs) {
      const seen = new Set<string>()
      for (const tok of doc) {
        if (STOP.has(tok) || seen.has(tok)) continue
        seen.add(tok)
        df.set(tok, (df.get(tok) ?? 0) + 1)
      }
    }
    const kept = [...df.entries()]
      .filter(([, count]) => count >= this.minDf)
      .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
      .slice(0, this.maxFeatures)
      .map(([name]) => name)
      .sort()

    const n = docs.length
    this.vocabulary = new Map()
    this.featureNames = kept
    this.idf = new Float64Array(kept.length)
    kept.forEach((name, index) => {
      const d = df.get(name) ?? 1
      const idf = Math.log((1 + n) / (1 + d)) + 1
      this.vocabulary.set(name, { index, df: d, idf, name })
      this.idf[index] = idf
    })
    this.fitted = true
  }

  transform(tokens: string[]): SparseVector {
    if (!this.fitted) throw new Error('TfidfVectorizer.transform called before fit')
    const counts = new Map<number, number>()
    for (const tok of tokens) {
      if (STOP.has(tok)) continue
      const entry = this.vocabulary.get(tok)
      if (!entry) continue
      counts.set(entry.index, (counts.get(entry.index) ?? 0) + 1)
    }
    const vec: SparseVector = new Map()
    let norm = 0
    counts.forEach((count, index) => {
      const tf = 1 + Math.log(count)
      const value = tf * this.idf[index]
      vec.set(index, value)
      norm += value * value
    })
    norm = Math.sqrt(norm)
    if (norm > 0) {
      vec.forEach((value, index) => vec.set(index, value / norm))
    }
    return vec
  }

  get size(): number {
    return this.featureNames.length
  }
}

export function cosine(a: SparseVector, b: SparseVector): number {
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let dot = 0
  small.forEach((v, k) => {
    const other = large.get(k)
    if (other !== undefined) dot += v * other
  })
  return dot
}
