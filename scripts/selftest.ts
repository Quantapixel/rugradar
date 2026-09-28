/**
 * Headless check that the model actually learns.
 * Run with: node scripts/selftest.ts
 */

import { createPipeline } from '../src/ml/pipeline.ts'

const pct = (x: number) => `${(x * 100).toFixed(1)}%`
const bar = (x: number, width = 28) => {
  const filled = Math.round(x * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)}`
}

const pipeline = createPipeline({ seed: 7, size: 800, epochs: 240, lr: 1.5, l2: 1e-4 })

const started = Date.now()
while (!pipeline.trainer.isDone()) pipeline.trainer.step(20)
const elapsed = Date.now() - started

const report = pipeline.finalize()

console.log('=== corpus ===')
console.log(`documents      : ${pipeline.corpus.length} (${pipeline.train.length} train / ${pipeline.test.length} test)`)
console.log(`vocabulary     : ${pipeline.vectorizer.size} features (min df 3, cap 8000)`)
console.log(`hostile share  : ${pct(pipeline.corpus.filter((s) => s.label === 1).length / pipeline.corpus.length)}`)
console.log(`train time     : ${elapsed}ms for ${pipeline.trainer.history.length} epochs`)

console.log('\n=== held-out synthetic test set ===')
const t = report.test
console.log(`accuracy       : ${pct(t.accuracy)}`)
console.log(`precision(rug) : ${pct(t.precision)}   recall(rug): ${pct(t.recall)}   f1: ${pct(t.f1)}`)
console.log(`confusion      : tp=${t.tp} fp=${t.fp} tn=${t.tn} fn=${t.fn}  (n=${t.n})`)
console.log(`final loss     : ${report.finalLoss.toFixed(4)}`)

const curve = pipeline.trainer.history
const sampleEpochs = [1, 10, 25, 50, 100, 150, 200, 240].filter((e) => e <= curve.length)
console.log('\n=== learning curve ===')
for (const e of sampleEpochs) {
  const row = curve[e - 1]
  console.log(`epoch ${String(e).padStart(3)} | loss ${row.loss.toFixed(3)} | train acc ${bar(row.trainAcc)} ${pct(row.trainAcc)}`)
}

console.log('\n=== out-of-distribution (hand-written, never trained on) ===')
for (const r of report.ood.results) {
  const truth = r.sample.label === 1 ? 'rug' : 'safe'
  console.log(
    `${r.correct ? 'PASS' : 'FAIL'} | truth=${truth.padEnd(4)} | p(rug)=${r.probability.toFixed(3)} | ${r.sample.id} (${r.sample.kind})`,
  )
}
console.log(`ood accuracy   : ${report.ood.caught}/${report.ood.total}`)

console.log('\n=== most informative learned features ===')
for (const f of pipeline.topFeatures(16)) {
  const direction = f.weight > 0 ? '-> RUG ' : '-> safe'
  console.log(`${direction} | ${f.weight.toFixed(3).padStart(7)} | df=${String(f.df).padStart(4)} | ${f.feature}`)
}

console.log('\n=== live prediction: hand-written honeypot ===')
const honeypot = pipeline.ood.find((s) => s.id === 'ood-honeypot')!
const prediction = pipeline.predict(honeypot.source)
console.log(`p(rug) = ${pct(prediction.probability)}  verdict=${prediction.verdict}`)
console.log('top risk features:')
for (const c of prediction.topRisk.slice(0, 8)) console.log(`  +${c.weight.toFixed(3)}  ${c.feature}`)
console.log('top safe features:')
for (const c of prediction.topSafe.slice(0, 5)) console.log(`  ${c.weight.toFixed(3)}  ${c.feature}`)
console.log('nearest training neighbours:')
for (const n of prediction.neighbours) {
  const truth = n.sample.label === 1 ? 'rug ' : 'safe'
  console.log(`  ${n.similarity.toFixed(3)}  ${truth}  ${n.sample.kind}`)
}

console.log('\n=== live prediction: vanilla token ===')
const vanilla = pipeline.ood.find((s) => s.id === 'ood-vanilla')!
const vp = pipeline.predict(vanilla.source)
console.log(`p(rug) = ${pct(vp.probability)}  verdict=${vp.verdict}`)
for (const c of vp.topRisk.slice(0, 4)) console.log(`  +${c.weight.toFixed(3)}  ${c.feature}`)
