/**
 * The full pipeline: generate a corpus, featurise it, train a linear model on
 * a held-out split, then explain individual predictions.
 */

import { TfidfVectorizer, cosine, identifierSpans, tokenize, type SparseVector } from './featurize.ts'
import { createTrainer, evaluate, score, type Metrics, type Trainer } from './logreg.ts'
import { generateCorpus, type Sample } from './corpus.ts'
import { HANDWRITTEN } from './handwritten.ts'
import { mulberry32, shuffle } from './rng.ts'

export type Contribution = { feature: string; weight: number }
export type Neighbour = { sample: Sample; similarity: number }
export type Span = { start: number; end: number; text: string; weight: number }

export type Verdict = 'hostile' | 'likely-hostile' | 'unclear' | 'benign'

export type Prediction = {
  probability: number
  verdict: Verdict
  topRisk: Contribution[]
  topSafe: Contribution[]
  neighbours: Neighbour[]
  spans: Span[]
  matchedFeatures: number
}

export type OodResult = { sample: Sample; probability: number; correct: boolean }

export type FinalReport = {
  test: Metrics
  ood: { results: OodResult[]; accuracy: number; caught: number; total: number }
  finalLoss: number
}

export type PipelineOptions = {
  seed?: number
  size?: number
  epochs?: number
  lr?: number
  l2?: number
  testFraction?: number
}

const verdictFor = (p: number): Verdict => {
  if (p >= 0.8) return 'hostile'
  if (p >= 0.5) return 'likely-hostile'
  if (p >= 0.3) return 'unclear'
  return 'benign'
}

/** Per-occurrence attribution weight (idf / document norm) used for highlighting. */
function occurrenceWeights(vec: TfidfVectorizer, tokens: string[]): Map<number, number> {
  const counts = new Map<number, number>()
  for (const token of tokens) {
    const entry = vec.vocabulary.get(token)
    if (entry) counts.set(entry.index, (counts.get(entry.index) ?? 0) + 1)
  }
  let norm = 0
  counts.forEach((count, index) => {
    const value = (1 + Math.log(count)) * vec.idf[index]
    norm += value * value
  })
  norm = Math.sqrt(norm) || 1
  const out = new Map<number, number>()
  counts.forEach((_count, index) => out.set(index, vec.idf[index] / norm))
  return out
}

export function createPipeline(options: PipelineOptions = {}) {
  const seed = options.seed ?? 7
  const size = options.size ?? 800
  const epochs = options.epochs ?? 240
  const lr = options.lr ?? 1.5
  const l2 = options.l2 ?? 1e-4
  const testFraction = options.testFraction ?? 0.2

  const corpus = generateCorpus(size, seed)
  const rng = mulberry32(seed ^ 0x9e3779b9)
  const shuffled = shuffle(rng, corpus)
  const testCount = Math.round(shuffled.length * testFraction)
  const test = shuffled.slice(0, testCount)
  const train = shuffled.slice(testCount)

  const vectorizer = new TfidfVectorizer()
  vectorizer.fit(train.map((s) => tokenize(s.source)))

  const encode = (samples: Sample[]): SparseVector[] =>
    samples.map((s) => vectorizer.transform(tokenize(s.source)))

  const Xtrain = encode(train)
  const ytrain = train.map((s) => s.label)
  const Xtest = encode(test)
  const ytest = test.map((s) => s.label)

  const trainer: Trainer = createTrainer(Xtrain, ytrain, vectorizer.size, { X: Xtest, y: ytest }, {
    epochs,
    lr,
    l2,
  })

  const predict = (source: string): Prediction => {
    const tokens = tokenize(source)
    const x = vectorizer.transform(tokens)
    const probability = score(trainer.w, trainer.b, x)
    const { w } = trainer

    const contributions: Contribution[] = []
    x.forEach((value, index) => {
      const weight = w[index] * value
      const name = vectorizer.featureNames[index]
      if (name) contributions.push({ feature: name, weight })
    })
    contributions.sort((a, b) => b.weight - a.weight)

    const occurrence = occurrenceWeights(vectorizer, tokens)
    const spans: Span[] = identifierSpans(source).map((span) => {
      let weight = 0
      for (const part of span.parts) {
        const entry = vectorizer.vocabulary.get(part)
        if (!entry) continue
        const occ = occurrence.get(entry.index)
        if (occ === undefined) continue
        weight += w[entry.index] * occ
      }
      return { start: span.start, end: span.end, text: span.text, weight }
    })

    const trainVectors = Xtrain
    const neighbours: Neighbour[] = train
      .map((sample, i) => ({ sample, similarity: cosine(x, trainVectors[i]) }))
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, 3)

    return {
      probability,
      verdict: verdictFor(probability),
      topRisk: contributions.filter((c) => c.weight > 0).slice(0, 10),
      topSafe: contributions.filter((c) => c.weight < 0).slice(-10).reverse(),
      neighbours,
      spans,
      matchedFeatures: x.size,
    }
  }

  const finalize = (): FinalReport => {
    const testMetrics = evaluate(trainer.w, trainer.b, Xtest, ytest)
    const results: OodResult[] = HANDWRITTEN.map((sample) => {
      const probability = score(trainer.w, trainer.b, vectorizer.transform(tokenize(sample.source)))
      const predicted = probability >= 0.5 ? 1 : 0
      return { sample, probability, correct: predicted === sample.label }
    })
    const caught = results.filter((r) => r.correct).length
    const last = trainer.history[trainer.history.length - 1]
    return {
      test: testMetrics,
      ood: {
        results,
        accuracy: results.length === 0 ? 0 : caught / results.length,
        caught,
        total: results.length,
      },
      finalLoss: last ? last.loss : 0,
    }
  }

  const topFeatures = (count: number) =>
    vectorizer.featureNames
      .map((feature, index) => ({
        feature,
        weight: trainer.w[index],
        df: vectorizer.vocabulary.get(feature)?.df ?? 0,
      }))
      .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight))
      .slice(0, count)

  return {
    vectorizer,
    trainer,
    train,
    test,
    corpus,
    ood: HANDWRITTEN,
    options: { seed, size, epochs, lr, l2, testFraction },
    predict,
    finalize,
    topFeatures,
  }
}

export type Pipeline = ReturnType<typeof createPipeline>
