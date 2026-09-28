import { useMemo, useRef, useState } from 'react'
import { buildReport, type Explanation } from '../ml/explain.ts'
import type { Prediction, Span } from '../ml/pipeline.ts'
import { BarList, Button, Card, CardHead, Dial, Pill, RadarMark, StageBar, TONE_HEX, type Tone } from './ui.tsx'

export type WorkSample = {
  id: string
  name: string
  note: string
  truth: 'hostile' | 'benign'
  source: string
}

const VERDICT: Record<Prediction['verdict'], { tone: Tone; label: string }> = {
  hostile: { tone: 'danger', label: 'Hostile control patterns' },
  'likely-hostile': { tone: 'warn', label: 'Likely hostile' },
  unclear: { tone: 'info', label: 'Unclear — read the flags' },
  benign: { tone: 'safe', label: 'No hostile patterns found' },
}

const STAGES = ['tokenise', 'tf-idf', 'classify', 'attribute']

function HighlightedSource({ source, spans }: { source: string; spans: Span[] }) {
  const lines = useMemo(() => source.split('\n'), [source])
  const maxAbs = useMemo(() => Math.max(1e-6, ...spans.map((s) => Math.abs(s.weight))), [spans])

  const starts = useMemo(() => {
    const out: number[] = []
    let offset = 0
    for (const line of lines) {
      out.push(offset)
      offset += line.length + 1
    }
    return out
  }, [lines])

  const byLine = useMemo(() => {
    const map = new Map<number, Span[]>()
    for (const span of spans) {
      let lo = 0
      let hi = starts.length - 1
      let found = 0
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (starts[mid] <= span.start) {
          found = mid
          lo = mid + 1
        } else {
          hi = mid - 1
        }
      }
      const list = map.get(found)
      if (list) list.push(span)
      else map.set(found, [span])
    }
    return map
  }, [spans, starts])

  return (
    <div className="surface-inset max-h-[420px] overflow-auto px-3 py-3 text-[12px] leading-[1.65]">
      {lines.map((line, index) => {
        const lineStart = starts[index]
        const spansHere = byLine.get(index) ?? []
        const segments: { text: string; weight: number }[] = []
        let cursor = lineStart
        for (const span of spansHere) {
          if (span.start > cursor) segments.push({ text: line.slice(cursor - lineStart, span.start - lineStart), weight: 0 })
          segments.push({ text: span.text, weight: span.weight })
          cursor = span.end
        }
        if (cursor < lineStart + line.length) {
          segments.push({ text: line.slice(cursor - lineStart), weight: 0 })
        }
        return (
          <div key={index} className="flex gap-3">
            <span className="tnum w-9 shrink-0 select-none text-right text-[11px] text-edge-2">{index + 1}</span>
            <code className="whitespace-pre-wrap break-all">
              {segments.map((segment, i) => {
                if (segment.weight === 0) return <span key={i}>{segment.text}</span>
                const t = Math.min(1, Math.abs(segment.weight) / maxAbs)
                const background =
                  segment.weight > 0 ? `rgba(255,77,94,${0.16 + 0.44 * t})` : `rgba(52,217,165,${0.12 + 0.34 * t})`
                return (
                  <span key={i} style={{ background, borderRadius: 4, padding: '1px 0' }} title={`weight ${segment.weight.toFixed(3)}`}>
                    {segment.text}
                  </span>
                )
              })}
            </code>
          </div>
        )
      })}
    </div>
  )
}

export function Workbench({
  samples,
  source,
  onSourceChange,
  onAnalyze,
  onClear,
  prediction,
  explanation,
  busy,
  ready,
  activeSampleId,
  stageIndex,
  autoScan,
  onToggleAutoScan,
  vocabSize,
}: {
  samples: WorkSample[]
  source: string
  onSourceChange: (value: string) => void
  onAnalyze: (value: string) => void
  onClear: () => void
  prediction: Prediction | null
  explanation: Explanation | null
  busy: boolean
  ready: boolean
  activeSampleId: string | null
  stageIndex: number
  autoScan: boolean
  onToggleAutoScan: () => void
  vocabSize: number
}) {
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)

  const verdict = prediction ? VERDICT[prediction.verdict] : null
  const maxRisk = prediction ? Math.max(0.0001, ...prediction.topRisk.map((c) => c.weight)) : 1
  const maxSafe = prediction ? Math.max(0.0001, ...prediction.topSafe.map((c) => Math.abs(c.weight))) : 1
  const activeSample = samples.find((s) => s.id === activeSampleId) ?? null

  const neighbours = useMemo(() => {
    if (!prediction) return []
    const seen = new Set<string>()
    return prediction.neighbours.filter((n) => {
      const key = `${n.sample.label}:${n.sample.kind}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }, [prediction])

  const expectation = useMemo(() => {
    if (!activeSample || !prediction) return null
    const predictedHostile = prediction.verdict === 'hostile' || prediction.verdict === 'likely-hostile'
    return { sample: activeSample, agrees: (activeSample.truth === 'hostile') === predictedHostile }
  }, [activeSample, prediction])

  const readFile = (file: File) => {
    file.text().then((text) => {
      onSourceChange(text)
      onAnalyze(text)
    })
  }

  const makeReport = () =>
    prediction && explanation
      ? buildReport({
          source,
          prediction,
          explanation,
          expectation: activeSample ? { name: activeSample.name, truth: activeSample.truth } : null,
        })
      : ''

  const copyReport = () => {
    const report = makeReport()
    if (!report) return
    navigator.clipboard.writeText(report).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1800)
      },
      () => setCopied(false),
    )
  }

  const downloadReport = () => {
    const report = makeReport()
    if (!report) return
    const url = URL.createObjectURL(new Blob([report], { type: 'text/markdown;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'rugradar-report.md'
    anchor.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="min-w-0">
          <CardHead title="Contract source" />
          <div className="space-y-3.5 px-5 pb-5 sm:px-6">
            <div className="-mx-1 flex min-w-0 gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {samples.map((sample) => {
                const active = sample.id === activeSampleId
                return (
                  <button
                    key={sample.id}
                    type="button"
                    title={sample.note}
                    onClick={() => onAnalyze(sample.source)}
                    className={`flex shrink-0 items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] whitespace-nowrap transition ${
                      active
                        ? 'border-radar/50 bg-radar/12 text-radar'
                        : 'border-white/10 bg-white/[0.03] text-muted hover:border-white/25 hover:text-chalk'
                    }`}
                  >
                    <span
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: sample.truth === 'hostile' ? TONE_HEX.danger : TONE_HEX.safe }}
                    />
                    {sample.name}
                  </button>
                )
              })}
            </div>

            <div
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault()
                setDragging(false)
                const file = event.dataTransfer.files[0]
                if (file) readFile(file)
              }}
              className={`surface-inset overflow-hidden transition ${dragging ? 'border-radar/60' : ''}`}
            >
              <div className="flex items-center justify-between gap-3 border-b border-white/6 px-3 py-2">
                <span className="font-mono text-[11px] text-muted">contract.sol</span>
                <div className="flex items-center gap-1">
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".sol,.txt,text/plain"
                    className="hidden"
                    onChange={(event) => {
                      const file = event.target.files?.[0]
                      if (file) readFile(file)
                      event.target.value = ''
                    }}
                  />
                  <Button variant="subtle" className="px-2 py-1 text-[11px]" onClick={() => fileRef.current?.click()}>
                    open file
                  </Button>
                  <Button variant="subtle" className="px-2 py-1 text-[11px]" onClick={onClear}>
                    clear
                  </Button>
                </div>
              </div>
              <textarea
                value={source}
                onChange={(event) => onSourceChange(event.target.value)}
                spellCheck={false}
                aria-label="Solidity source"
                placeholder="// paste Solidity source here — or drop a .sol file"
                className="h-[300px] w-full resize-y bg-transparent px-3 py-3 text-[12px] leading-[1.65] text-chalk outline-none placeholder:text-muted/60"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={() => onAnalyze(source)} disabled={!ready || busy || source.trim().length === 0}>
                {busy ? 'Scanning…' : 'Scan contract'}
              </Button>
              <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted">
                <input type="checkbox" checked={autoScan} onChange={onToggleAutoScan} className="h-3.5 w-3.5 accent-[#ffb020]" />
                scan while typing
              </label>
              <span className="tnum ml-auto font-mono text-[11px] text-muted">
                {source.split('\n').length} lines
              </span>
            </div>

            {busy ? <StageBar stages={STAGES} activeIndex={stageIndex} /> : null}
          </div>
        </Card>

        <Card className={`min-w-0 ${prediction ? 'rise' : ''}`}>
          <CardHead
            title="Verdict"
            right={
              verdict ? (
                <>
                  <Pill tone={verdict.tone} dot>
                    {verdict.label}
                  </Pill>
                  <Button variant="ghost" className="px-2.5 py-1.5 text-[11px]" onClick={copyReport}>
                    {copied ? 'copied' : 'export'}
                  </Button>
                  <Button variant="ghost" className="px-2.5 py-1.5 text-[11px]" onClick={downloadReport} title="download as markdown">
                    .md
                  </Button>
                </>
              ) : null
            }
          />
          <div className="px-5 pb-5 sm:px-6">
            {!prediction ? (
              <div className="flex h-[380px] flex-col items-center justify-center gap-4 text-center">
                <RadarMark size={88} active={busy || !ready} />
                <p className="max-w-[15rem] text-sm leading-relaxed text-muted">
                  {ready ? 'Pick a sample or paste a contract, then scan it.' : 'Training the classifier…'}
                </p>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col items-center gap-5 sm:flex-row">
                  <Dial probability={prediction.probability} tone={verdict!.tone} caption="p(rug)" />
                  <div className="space-y-2.5">
                    <p className="text-[15px] leading-relaxed text-chalk">{explanation?.headline}</p>
                    {expectation ? (
                      <Pill tone={expectation.agrees ? 'safe' : 'danger'} dot>
                        ground truth {expectation.sample.truth} · model {expectation.agrees ? 'agrees' : 'disagrees'}
                      </Pill>
                    ) : null}
                  </div>
                </div>

                {explanation && explanation.risk.length > 0 ? (
                  <ul className="space-y-2">
                    {explanation.risk.slice(0, 4).map((item) => (
                      <li key={item.label} className="surface-inset px-3.5 py-3">
                        <div className="flex items-center gap-2">
                          <Pill tone={item.severity === 'critical' ? 'danger' : item.severity === 'high' ? 'warn' : 'info'}>
                            {item.severity}
                          </Pill>
                          <span className="text-sm font-medium text-chalk">{item.label}</span>
                        </div>
                        <p className="mt-2 text-xs leading-relaxed text-muted">{item.sentence}</p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {explanation && explanation.safety.length > 0 ? (
                  <ul className="space-y-1.5">
                    {explanation.safety.slice(0, 3).map((item) => (
                      <li key={item.label} className="flex gap-2.5 text-xs leading-relaxed text-muted">
                        <span className="mt-0.5 text-safe">✓</span>
                        <span>
                          <span className="text-chalk">{item.label}.</span> {item.sentence}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}

                {explanation ? (
                  <div className="border-t border-white/6 pt-4">
                    <h3 className="mb-2.5 text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">Before you buy</h3>
                    <ul className="space-y-1.5">
                      {explanation.nextSteps.slice(0, 3).map((step) => (
                        <li key={step} className="flex gap-2.5 text-xs leading-relaxed text-muted">
                          <span className="mt-0.5 text-radar">→</span>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </Card>
      </div>

      {prediction ? (
        <Card className="rise min-w-0">
          <CardHead
            title="Where the model looked"
            hint="Hover a highlight to see its weight."
            right={
              <div className="flex items-center gap-3 text-[11px] text-muted">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded" style={{ background: 'rgba(255,77,94,0.5)' }} /> hostile
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded" style={{ background: 'rgba(52,217,165,0.42)' }} /> clean
                </span>
              </div>
            }
          />
          <div className="space-y-4 px-5 pb-5 sm:px-6">
            <HighlightedSource source={source} spans={prediction.spans} />

            <details className="group">
              <summary className="cursor-pointer list-none text-[11px] font-semibold tracking-[0.18em] text-muted uppercase transition hover:text-chalk">
                raw feature weights
                <span className="ml-2 font-mono normal-case tracking-normal text-edge-2 group-open:hidden">
                  {prediction.matchedFeatures} of {vocabSize.toLocaleString()} features hit
                </span>
              </summary>
              <div className="mt-4 grid gap-6 sm:grid-cols-2">
                <div>
                  <h4 className="mb-2.5 text-[11px] font-semibold tracking-[0.18em] text-danger uppercase">Toward hostile</h4>
                  <BarList
                    items={prediction.topRisk.slice(0, 6).map((c) => ({ label: c.feature, value: c.weight }))}
                    max={maxRisk}
                    tone="danger"
                  />
                </div>
                <div>
                  <h4 className="mb-2.5 text-[11px] font-semibold tracking-[0.18em] text-safe uppercase">Toward clean</h4>
                  <BarList
                    items={prediction.topSafe.slice(0, 6).map((c) => ({ label: c.feature, value: Math.abs(c.weight) }))}
                    max={maxSafe}
                    tone="safe"
                  />
                </div>
              </div>
              {neighbours.length > 0 ? (
                <div className="mt-6">
                  <h4 className="mb-2.5 text-[11px] font-semibold tracking-[0.18em] text-muted uppercase">
                    Nearest contracts in training
                  </h4>
                  <div className="flex flex-wrap gap-2">
                    {neighbours.map((neighbour) => (
                      <button
                        key={neighbour.sample.id}
                        type="button"
                        onClick={() => onAnalyze(neighbour.sample.source)}
                        className="surface-inset surface-hover flex items-center gap-2 px-3 py-2 text-[11px] whitespace-nowrap"
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ background: neighbour.sample.label === 1 ? TONE_HEX.danger : TONE_HEX.safe }}
                        />
                        <span className="font-mono text-chalk">{neighbour.similarity.toFixed(2)}</span>
                        <span className="text-muted">{neighbour.sample.kind}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </details>
          </div>
        </Card>
      ) : null}
    </>
  )
}
