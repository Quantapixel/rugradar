/**
 * A thin explanation layer over the model's attributions.
 *
 * The classifier says "82% hostile"; these rules say *which powers* that
 * corresponds to, in words a trader can act on. They are matched against the
 * model's own top-weighted features, so the narrative can only ever be about
 * tokens the model actually reacted to.
 */

import type { Prediction } from './pipeline.ts'

export type Severity = 'critical' | 'high' | 'medium'

type RiskRule = {
  match: RegExp
  severity: Severity
  label: string
  sentence: string
}

const RISK_RULES: RiskRule[] = [
  {
    match: /blacklist|blocked|blocklist|bots/,
    severity: 'critical',
    label: 'Blacklist',
    sentence: 'The owner can block an address outright, and a blocked address cannot sell.',
  },
  {
    match: /selfdestruct|destroycontract/,
    severity: 'critical',
    label: 'Self-destruct',
    sentence: 'The owner can destroy the contract, which removes the token from circulation.',
  },
  {
    match: /seize|forcetransfer|recovertokens/,
    severity: 'critical',
    label: 'Seizure',
    sentence: 'The owner can move tokens out of any wallet, including yours.',
  },
  {
    match: /delegatecall|upgrade|implementation|logic/,
    severity: 'high',
    label: 'Upgradeable',
    sentence: 'The contract logic can be replaced after you buy, so today\'s rules are not binding.',
  },
  {
    match: /tx→origin|antibot/,
    severity: 'high',
    label: 'Bot guard',
    sentence: 'Transfers are screened by launch-time and caller checks that can reject your transaction.',
  },
  {
    match: /mint|batchmint/,
    severity: 'high',
    label: 'Mint authority',
    sentence: 'The owner can mint new supply, diluting your position without limit.',
  },
  {
    match: /sell|tax|fees|fee(?!→?bps)/,
    severity: 'high',
    label: 'Mutable fees',
    sentence: 'Trading fees can be changed by the owner, and a sell tax that is large enough is a honeypot.',
  },
  {
    match: /trading→(enabled|active|open)|enable→trading|start→trading/,
    severity: 'high',
    label: 'Trading gate',
    sentence: 'Trading can be switched off, which can strand holders who already bought.',
  },
  {
    match: /cooldown|lasttrade|lastbuy|slow→down/,
    severity: 'high',
    label: 'Rate limiting',
    sentence: 'Transfers can be rate-limited per address through an owner-set cooldown.',
  },
  {
    match: /max→(tx|wallet)|walletlimit|maxtx|maxwallet|limits/,
    severity: 'medium',
    label: 'Trade limits',
    sentence: 'Sale size can be capped by the owner, so you may not be able to exit a position in one go.',
  },
  {
    match: /pause|paused/,
    severity: 'medium',
    label: 'Pausable',
    sentence: 'Transfers can be paused by the owner.',
  },
  {
    match: /excluded|exclude/,
    severity: 'medium',
    label: 'Selective exemptions',
    sentence: 'Some addresses can be exempted from rules that apply to everyone else.',
  },
]

const SAFETY_RULES: { match: RegExp; label: string; sentence: string }[] = [
  {
    match: /cap|max→fee|fee→cap|maximum|maxtotalfee/,
    label: 'Fee cap enforced',
    sentence: 'Fee changes are bounded by a constant, so they cannot reach a punitive level.',
  },
  {
    match: /supply|hardcap|total/,
    label: 'Supply cap',
    sentence: 'Minting is bounded by a fixed supply cap.',
  },
  {
    match: /pending|timelock|delay/,
    label: 'Timelocked ownership',
    sentence: 'Ownership changes go through a timelock instead of taking effect instantly.',
  },
  {
    match: /burn/,
    label: 'Burn',
    sentence: 'Holders can burn their own tokens.',
  },
  {
    match: /constant|immutable/,
    label: 'Immutable parameters',
    sentence: 'Key parameters are declared constant rather than stored and mutable.',
  },
]

export type Explanation = {
  headline: string
  risk: { label: string; severity: Severity; sentence: string; weight: number }[]
  safety: { label: string; sentence: string }[]
  nextSteps: string[]
}

const NEXT_STEPS = [
  'Simulate a buy and an immediate sell on a honeypot checker before you trade.',
  'Check whether liquidity is locked and who holds the LP tokens.',
  'Check whether ownership has been renounced, and whether it can be reclaimed.',
  'Treat a token whose owner can change the rules as a counterparty, not as a store of value.',
]

export function explainPrediction(prediction: Prediction): Explanation {
  const riskFeatures = prediction.topRisk
  const matched: Explanation['risk'] = []
  const seen = new Set<string>()

  for (const contribution of riskFeatures) {
    for (const rule of RISK_RULES) {
      if (seen.has(rule.label)) continue
      if (!rule.match.test(contribution.feature)) continue
      seen.add(rule.label)
      matched.push({
        label: rule.label,
        severity: rule.severity,
        sentence: rule.sentence,
        weight: contribution.weight,
      })
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2 }
  matched.sort((a, b) => order[a.severity] - order[b.severity] || b.weight - a.weight)

  const safetyFeatures = prediction.topSafe.map((c) => c.feature).join(' ')
  const safety: Explanation['safety'] = []
  for (const rule of SAFETY_RULES) {
    if (rule.match.test(safetyFeatures)) {
      safety.push({ label: rule.label, sentence: rule.sentence })
    }
  }

  const top = matched.slice(0, 3)
  let headline: string
  if (prediction.verdict === 'hostile' && top.length > 0) {
    headline = `The owner holds ${top.map((t) => t.label.toLowerCase()).join(', ')}.`
  } else if (prediction.verdict === 'likely-hostile') {
    headline = top[0] ? `Matches hostile patterns, most notably ${top[0].label.toLowerCase()}.` : 'Matches hostile patterns in the training corpus.'
  } else if (prediction.verdict === 'unclear') {
    headline = 'Some admin powers are present. Not an obvious honeypot, not a clean token either.'
  } else {
    headline = 'No hostile control patterns detected in the source.'
  }

  return { headline, risk: matched.slice(0, 6), safety, nextSteps: NEXT_STEPS }
}

const VERDICT_LABEL: Record<Prediction['verdict'], string> = {
  hostile: 'HOSTILE',
  'likely-hostile': 'LIKELY HOSTILE',
  unclear: 'UNCLEAR',
  benign: 'NO HOSTILE PATTERNS',
}

/** Markdown report, so a scan can leave the browser as evidence. */
export function buildReport({
  source,
  prediction,
  explanation,
  expectation,
}: {
  source: string
  prediction: Prediction
  explanation: Explanation
  expectation?: { name: string; truth: 'hostile' | 'benign' } | null
}): string {
  const lines: string[] = []
  lines.push('# RugRadar report')
  lines.push('')
  lines.push(`**Verdict:** ${VERDICT_LABEL[prediction.verdict]} — p(rug) = ${(prediction.probability * 100).toFixed(1)}%`)
  lines.push('')
  lines.push(`**What it means:** ${explanation.headline}`)
  if (expectation) {
    const predictedHostile = prediction.verdict === 'hostile' || prediction.verdict === 'likely-hostile'
    const agrees = (expectation.truth === 'hostile') === predictedHostile
    lines.push('')
    lines.push(`**Ground truth for \`${expectation.name}\`:** ${expectation.truth} — model ${agrees ? 'agrees' : 'disagrees'}.`)
  }
  lines.push('')

  if (explanation.risk.length > 0) {
    lines.push('## Powers found')
    lines.push('')
    for (const item of explanation.risk) {
      lines.push(`- **${item.label}** (${item.severity}) — ${item.sentence}`)
    }
    lines.push('')
  }

  if (explanation.safety.length > 0) {
    lines.push('## Working in your favour')
    lines.push('')
    for (const item of explanation.safety) {
      lines.push(`- **${item.label}** — ${item.sentence}`)
    }
    lines.push('')
  }

  lines.push('## Attribution')
  lines.push('')
  lines.push('| toward rug | weight | toward clean | weight |')
  lines.push('| --- | --- | --- | --- |')
  const rows = Math.max(prediction.topRisk.length, prediction.topSafe.length)
  for (let i = 0; i < Math.min(rows, 8); i++) {
    const risk = prediction.topRisk[i]
    const safe = prediction.topSafe[i]
    lines.push(
      `| ${risk ? `\`${risk.feature}\`` : ''} | ${risk ? risk.weight.toFixed(3) : ''} | ${safe ? `\`${safe.feature}\`` : ''} | ${
        safe ? safe.weight.toFixed(3) : ''
      } |`,
    )
  }
  lines.push('')

  if (prediction.neighbours.length > 0) {
    lines.push('## Nearest contracts in the training set')
    lines.push('')
    for (const neighbour of prediction.neighbours) {
      lines.push(
        `- ${neighbour.similarity.toFixed(3)} · ${neighbour.sample.label === 1 ? 'rug' : 'clean'} · ${neighbour.sample.kind}`,
      )
    }
    lines.push('')
  }

  lines.push('## Suggested next steps')
  lines.push('')
  for (const step of explanation.nextSteps) lines.push(`- ${step}`)
  lines.push('')

  lines.push('## Source under analysis')
  lines.push('')
  lines.push('```solidity')
  lines.push(source.trim())
  lines.push('```')
  lines.push('')
  lines.push(
    '_Generated by RugRadar. A heuristic linear model trained on a generated corpus; it narrows the search space and is not a security audit._',
  )
  return lines.join('\n')
}
