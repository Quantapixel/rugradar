import type { EpochStat } from '../ml/logreg.ts'
import type { FinalReport, Pipeline } from '../ml/pipeline.ts'
import { BarList, Card, CardHead, ConfusionMatrix, Meter, Pill, Sparkline, Stat } from './ui.tsx'

const pct = (value: number) => `${(value * 100).toFixed(1)}%`

function prettify(kind: string): string {
  return kind.replace(/-/g, ' ').replace(/\+/g, ' + ')
}

export function ModelPanel({
  history,
  report,
  pipeline,
  training,
  elapsedMs,
  onRetrain,
}: {
  history: EpochStat[]
  report: FinalReport | null
  pipeline: Pipeline | null
  training: boolean
  elapsedMs: number | null
  onRetrain: () => void
}) {
  const last = history[history.length - 1]
  const losses = history.map((h) => h.loss)
  const accuracies = history.map((h) => h.trainAcc)
  // Features present in almost every document carry no discriminative signal
  // (idf is ~0), so drop them from the display rather than let `erc20` headline.
  const features = pipeline
    ? pipeline.topFeatures(40).filter((f) => pipeline.corpus.length === 0 || f.df < pipeline.corpus.length * 0.75).slice(0, 10)
    : []
  const maxFeature = Math.max(0.001, ...features.map((f) => Math.abs(f.weight)))

  const composition = (() => {
    if (!pipeline) return []
    const counts = new Map<string, number>()
    for (const sample of pipeline.corpus) {
      for (const part of sample.kind.split('+')) {
        counts.set(part, (counts.get(part) ?? 0) + 1)
      }
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 9)
  })()
  const maxComposition = Math.max(1, ...composition.map(([, count]) => count))

  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card className="min-w-0">
        <CardHead
          title="Training run"
          hint="Full-batch gradient descent, live."
          right={
            <button
              type="button"
              onClick={onRetrain}
              disabled={training}
              className="rounded-lg border border-edge-2 px-3 py-1.5 text-[11px] text-muted transition hover:border-radar/50 hover:text-chalk disabled:opacity-40"
            >
              new corpus
            </button>
          }
        />
        <div className="space-y-4 p-5">
          <div className="surface-inset p-3.5 font-mono text-[11px] leading-[1.75] text-muted">
            <div>
              corpus ......... <span className="text-chalk">{pipeline ? pipeline.corpus.length : 0}</span> contracts
            </div>
            <div>
              split .......... <span className="text-chalk">{pipeline ? pipeline.train.length : 0}</span> train /{' '}
              <span className="text-chalk">{pipeline ? pipeline.test.length : 0}</span> test
            </div>
            <div>
              labels ......... <span className="text-chalk">50%</span> hostile
            </div>
            <div>
              vocabulary ..... <span className="text-chalk">{pipeline ? pipeline.vectorizer.size.toLocaleString() : 0}</span> tf-idf dimensions
            </div>
            <div>
              optimiser ...... <span className="text-chalk">lr {pipeline ? pipeline.options.lr : 1.5}</span>, l2 {pipeline ? pipeline.options.l2 : '1e-4'}
            </div>
            <div>
              epoch .......... <span className="text-chalk">{history.length}</span>
              {pipeline ? <span className="text-muted">/{pipeline.options.epochs}</span> : null}
            </div>
            <div>
              loss ........... <span className="text-chalk">{last ? last.loss.toFixed(4) : '—'}</span>
            </div>
            <div>
              train acc ...... <span className="text-chalk">{last ? pct(last.trainAcc) : '—'}</span>
            </div>
            <div>
              wall clock .....{' '}
              <span className="text-chalk">{training ? 'running…' : elapsedMs !== null ? `${elapsedMs.toFixed(0)}ms` : '—'}</span>
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
              <span>training loss</span>
              <span className="tnum font-mono">
                {losses.length > 1 ? `${losses[0].toFixed(3)} → ${losses[losses.length - 1].toFixed(3)}` : '—'}
              </span>
            </div>
            <Sparkline values={losses} tone="warn" height={54} label="loss" />
          </div>
          <div>
            <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
              <span>train accuracy</span>
              <span className="tnum font-mono">{accuracies.length > 1 ? pct(accuracies[accuracies.length - 1]) : '—'}</span>
            </div>
            <Sparkline values={accuracies} tone="safe" height={54} label="accuracy" />
          </div>
        </div>
      </Card>

      <Card className="min-w-0">
        <CardHead title="Evaluation" hint="Held-out split of the corpus, plus five contracts written by hand." />
        <div className="space-y-4 p-5">
          <div className="grid grid-cols-2 gap-2">
            <Stat label="test accuracy" value={report ? pct(report.test.accuracy) : '—'} hint={report ? `n = ${report.test.n}` : undefined} />
            <Stat label="precision" value={report ? pct(report.test.precision) : '—'} hint="of flagged contracts" />
            <Stat label="recall" value={report ? pct(report.test.recall) : '—'} hint="rugs caught" />
            <Stat label="f1" value={report ? pct(report.test.f1) : '—'} hint="harmonic mean" />
          </div>
          {report ? <ConfusionMatrix tp={report.test.tp} fp={report.test.fp} tn={report.test.tn} fn={report.test.fn} /> : null}

          <div>
            <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
              hand-written check
              {report ? <Pill tone={report.ood.accuracy >= 0.8 ? 'safe' : 'warn'}>{report.ood.caught}/{report.ood.total}</Pill> : null}
            </h3>
            <ul className="space-y-1.5">
              {report
                ? report.ood.results.map((result) => (
                    <li key={result.sample.id} className="flex items-center gap-2 text-[11px]">
                      <span className={result.correct ? 'text-safe' : 'text-danger'}>{result.correct ? '✓' : '✗'}</span>
                      <span className="min-w-0 flex-1 truncate text-muted">{prettify(result.sample.kind)}</span>
                      <span className="tnum font-mono text-chalk">{result.probability.toFixed(2)}</span>
                      <span className="w-8 text-right text-muted">{result.sample.label === 1 ? 'rug' : 'safe'}</span>
                    </li>
                  ))
                : null}
            </ul>
          </div>
        </div>
      </Card>

      <Card className="min-w-0">
        <CardHead title="What it learned" hint="Largest weights in the linear model, and the corpus they came from." />
        <div className="space-y-5 p-5">
          <BarList
            items={features.map((f) => ({
              label: f.feature,
              value: Math.abs(f.weight),
              note: `${f.weight > 0 ? '+' : ''}${f.weight.toFixed(2)} · df ${f.df}`,
            }))}
            max={maxFeature}
            tone="info"
          />

          <div>
            <h3 className="mb-2.5 text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">corpus composition</h3>
            <ul className="space-y-2">
              {composition.map(([kind, count]) => (
                <li key={kind}>
                  <div className="flex items-baseline justify-between gap-3 text-[11px]">
                    <span className="truncate text-muted">{prettify(kind)}</span>
                    <span className="tnum font-mono text-chalk">{count}</span>
                  </div>
                  <div className="mt-1">
                    <Meter value={count} max={maxComposition} tone="neutral" />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  )
}
