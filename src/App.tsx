import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { explainPrediction, type Explanation } from './ml/explain.ts'
import type { EpochStat } from './ml/logreg.ts'
import { createPipeline, type FinalReport, type Pipeline, type Prediction } from './ml/pipeline.ts'
import { ModelPanel } from './components/ModelPanel.tsx'
import { Workbench, type WorkSample } from './components/Workbench.tsx'
import { Card, CardHead, Pill, RadarMark } from './components/ui.tsx'

const prettify = (kind: string) => kind.replace(/-/g, ' ').replace(/\+/g, ' + ')

/** Five hand-written contracts. Hostile first, so the first thing on screen is
 *  the tool catching something. */
function buildSamples(pipeline: Pipeline): WorkSample[] {
  return [...pipeline.ood]
    .sort((a, b) => b.label - a.label)
    .map((sample) => ({
      id: sample.id,
      name: prettify(sample.kind),
      note: sample.label === 1 ? 'hand-written, actually hostile' : 'hand-written, actually clean',
      truth: (sample.label === 1 ? 'hostile' : 'benign') as WorkSample['truth'],
      source: sample.source,
    }))
}

const STEPS = [
  ['Tokenise', 'Comments and strings are stripped so the model cannot cheat on author fingerprints. Identifiers split on camelCase, then unigrams and within-line bigrams.'],
  ['Weight', 'Sublinear TF-IDF with a document-frequency floor and L2 normalisation, so contract length cannot dominate the vector.'],
  ['Classify', 'Logistic regression trained from scratch by gradient descent with class-balanced loss, then attributed feature by feature.'],
]

const LIMITS = [
  'Accuracy on a held-out split of the generated corpus measures the generator as much as the model. The five hand-written contracts are the number worth trusting.',
  'It reads structure, not meaning. A nominal cap that still permits 100% is a known blind spot — that case is in the sample set on purpose.',
  'Not a honeypot detector. Real honeypot detection means simulating a buy and an immediate sell; this narrows the search space first.',
  'Not a security audit. No parser, no control-flow analysis, no bytecode reasoning.',
]

export default function App() {
  const [view, setView] = useState<'scan' | 'model'>(() =>
    typeof window !== 'undefined' && window.location.hash === '#model' ? 'model' : 'scan',
  )
  const [seed, setSeed] = useState(7)
  const [pipeline, setPipeline] = useState<Pipeline | null>(null)
  const [samples, setSamples] = useState<WorkSample[]>([])
  const [history, setHistory] = useState<EpochStat[]>([])
  const [report, setReport] = useState<FinalReport | null>(null)
  const [training, setTraining] = useState(true)
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  const [source, setSource] = useState('')
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [explanation, setExplanation] = useState<Explanation | null>(null)
  const [busy, setBusy] = useState(false)
  const [stageIndex, setStageIndex] = useState(0)
  const [autoScan, setAutoScan] = useState(true)
  const pipelineRef = useRef<Pipeline | null>(null)
  const stageTimers = useRef<number[]>([])
  const lastScanned = useRef<string | null>(null)

  const clearStageTimers = useCallback(() => {
    stageTimers.current.forEach((id) => window.clearTimeout(id))
    stageTimers.current = []
  }, [])

  /* Train on mount, and whenever a new corpus is drawn. Time-based rather than
     frame-based so it finishes in ~700ms regardless of frame rate. */
  useEffect(() => {
    const next = createPipeline({ seed, size: 800, epochs: 240, lr: 1.5, l2: 1e-4 })
    pipelineRef.current = next
    setPipeline(next)
    const list = buildSamples(next)
    setSamples(list)
    setHistory([])
    setReport(null)
    setPrediction(null)
    setExplanation(null)
    setTraining(true)
    setElapsedMs(null)
    setBusy(false)
    lastScanned.current = null

    const started = performance.now()
    const totalEpochs = next.options.epochs
    let completed = 0
    let timer = 0

    const tick = () => {
      const elapsed = performance.now() - started
      const target = Math.min(totalEpochs, Math.max(1, Math.floor((elapsed / 700) * totalEpochs)))
      while (completed < target) {
        next.trainer.step(1)
        completed++
      }
      setHistory(next.trainer.history.slice())
      if (next.trainer.isDone()) {
        setReport(next.finalize())
        setElapsedMs(performance.now() - started)
        setTraining(false)
        const first = list[0]
        if (first) {
          const result = next.predict(first.source)
          lastScanned.current = first.source
          setSource(first.source)
          setPrediction(result)
          setExplanation(explainPrediction(result))
        }
        return
      }
      timer = window.setTimeout(tick, 16)
    }
    timer = window.setTimeout(tick, 16)
    return () => window.clearTimeout(timer)
  }, [seed])

  useEffect(() => () => clearStageTimers(), [clearStageTimers])

  const runScan = useCallback(
    (value: string, animated = true) => {
      const current = pipelineRef.current
      if (!current || training || value.trim().length === 0) return
      setSource(value)
      lastScanned.current = value
      const finish = () => {
        const result = current.predict(value)
        setPrediction(result)
        setExplanation(explainPrediction(result))
        setBusy(false)
        setStageIndex(4)
      }
      if (!animated) {
        finish()
        return
      }
      clearStageTimers()
      setBusy(true)
      setStageIndex(0)
      ;[120, 230, 340].forEach((ms, index) => {
        stageTimers.current.push(window.setTimeout(() => setStageIndex(index + 1), ms))
      })
      stageTimers.current.push(window.setTimeout(finish, 440))
    },
    [clearStageTimers, training],
  )

  /* Scan while typing, debounced. Cheap enough to feel live. */
  useEffect(() => {
    if (!autoScan || training || !pipeline) return
    if (source.trim().length < 40 || lastScanned.current === source) return
    const timer = window.setTimeout(() => runScan(source, false), 550)
    return () => window.clearTimeout(timer)
  }, [autoScan, training, pipeline, runScan, source])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        setView('scan')
        runScan(source, true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [runScan, source])

  const activeSampleId = useMemo(() => samples.find((sample) => sample.source === source)?.id ?? null, [samples, source])
  const vocabSize = pipeline ? pipeline.vectorizer.size : 0
  const changeView = (next: 'scan' | 'model') => {
    setView(next)
    window.history.replaceState(null, '', next === 'model' ? '#model' : '#scan')
  }

  return (
    <div className="relative min-h-screen">
      <div className="aurora" />
      <div className="grid-lines" />

      <header className="sticky top-0 z-30 border-b border-white/6 bg-void/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-5 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <RadarMark size={34} active={training || busy} />
            <div className="text-[13px] font-semibold tracking-[0.2em] text-chalk uppercase">RugRadar</div>
          </div>

          <div className="flex items-center gap-3">
            <Pill tone={training ? 'warn' : 'safe'} dot>
              {training ? 'training' : 'model ready'}
            </Pill>
            <div className="flex rounded-xl border border-white/10 bg-white/[0.03] p-0.5">
              {(['scan', 'model'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => changeView(option)}
                  className={`rounded-lg px-3.5 py-1.5 text-[12px] font-medium capitalize transition ${
                    view === option ? 'bg-white/[0.09] text-chalk' : 'text-muted hover:text-chalk'
                  }`}
                >
                  {option}
                </button>
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-7xl space-y-5 px-5 py-6 sm:px-6">
        {view === 'scan' ? (
          <>
            <section className="max-w-3xl">
              <h1 className="text-[24px] leading-tight font-semibold tracking-tight text-chalk sm:text-[28px]">
                Most rugs are visible in the source code<span className="text-radar">.</span>
              </h1>
              <p className="mt-2.5 text-sm leading-relaxed text-muted">
                Paste an ERC-20 and a purpose-trained classifier scores it, then shows which lines made it suspicious. Trained in this
                tab on {pipeline ? pipeline.corpus.length : 800} contracts in {elapsedMs !== null ? `${elapsedMs.toFixed(0)}ms` : '—'} — no
                API, no black box.
              </p>
            </section>

            <Workbench
              samples={samples}
              source={source}
              onSourceChange={setSource}
              onAnalyze={runScan}
              onClear={() => {
                setSource('')
                setPrediction(null)
                setExplanation(null)
                lastScanned.current = null
              }}
              prediction={prediction}
              explanation={explanation}
              busy={busy}
              ready={!training}
              activeSampleId={activeSampleId}
              stageIndex={stageIndex}
              autoScan={autoScan}
              onToggleAutoScan={() => setAutoScan((value) => !value)}
              vocabSize={vocabSize}
            />
          </>
        ) : (
          <>
            <Card>
              <CardHead
                title="How it works"
                hint="Three steps, all implemented in this repository — no ML framework, no external calls."
              />
              <ol className="grid gap-4 px-5 pb-5 sm:grid-cols-3 sm:px-6">
                {STEPS.map(([title, body], index) => (
                  <li key={title}>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-radar">0{index + 1}</span>
                      <span className="text-[13px] font-medium text-chalk">{title}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{body}</p>
                  </li>
                ))}
              </ol>
            </Card>

            <ModelPanel
              history={history}
              report={report}
              pipeline={pipeline}
              training={training}
              elapsedMs={elapsedMs}
              onRetrain={() => setSeed((value) => value + 1)}
            />

            <Card>
              <CardHead title="What this does not do" />
              <ul className="space-y-2 px-5 pb-5 sm:px-6">
                {LIMITS.map((limit) => (
                  <li key={limit} className="flex gap-2.5 text-xs leading-relaxed text-muted">
                    <span className="mt-0.5 text-radar">→</span>
                    <span>{limit}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </main>

      <footer className="relative z-10 border-t border-white/6 px-5 py-5 sm:px-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 text-[11px] text-muted">
          <span>Tokeniser, TF-IDF, logistic regression and evaluation are implemented in this repository.</span>
          <span className="font-mono">rugradar · built for Hacker House Goa</span>
        </div>
      </footer>
    </div>
  )
}
