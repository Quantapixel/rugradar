/**
 * Logistic regression trained by full-batch gradient descent with an L2 penalty.
 *
 * A linear model is the right call here rather than something deeper: the
 * feature space is sparse and the decision boundary is genuinely close to
 * linear ("does an uncapped, owner-controlled setter exist?"). It also yields
 * exact per-feature attribution, which is the entire point of this tool.
 */

import type { SparseVector } from './featurize.ts'

export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z))

export type EpochStat = { epoch: number; loss: number; trainAcc: number; testAcc: number | null }
export type TrainOptions = { epochs: number; lr: number; l2: number }

export type Metrics = {
  n: number
  accuracy: number
  precision: number
  recall: number
  f1: number
  tp: number
  fp: number
  tn: number
  fn: number
}

export type Trainer = {
  w: Float64Array
  b: number
  history: EpochStat[]
  total: number
  step: (count: number) => void
  isDone: () => boolean
}

/**
 * Creates an incremental trainer. `step(k)` advances k epochs, so the UI can
 * animate learning that is actually happening rather than replaying a canned
 * animation.
 */
export function createTrainer(
  X: SparseVector[],
  y: number[],
  dim: number,
  test: { X: SparseVector[]; y: number[] },
  opts: TrainOptions,
): Trainer {
  const w = new Float64Array(dim)
  let b = 0
  const history: EpochStat[] = []

  const positives = y.reduce((acc, v) => acc + v, 0)
  const negatives = y.length - positives
  const posWeight = positives > 0 ? y.length / (2 * positives) : 1
  const negWeight = negatives > 0 ? y.length / (2 * negatives) : 1
  const grad = new Float64Array(dim)

  const accuracyOn = (Xs: SparseVector[], ys: number[]): number => {
    if (Xs.length === 0) return 0
    let correct = 0
    for (let i = 0; i < Xs.length; i++) {
      let z = b
      Xs[i].forEach((v, k) => {
        z += w[k] * v
      })
      if ((sigmoid(z) >= 0.5 ? 1 : 0) === ys[i]) correct++
    }
    return correct / Xs.length
  }

  const step = (count: number): void => {
    for (let e = 0; e < count; e++) {
      grad.fill(0)
      let gradB = 0
      let loss = 0
      for (let i = 0; i < X.length; i++) {
        const x = X[i]
        let z = b
        x.forEach((v, k) => {
          z += w[k] * v
        })
        const p = sigmoid(z)
        const cls = y[i]
        const weight = cls === 1 ? posWeight : negWeight
        const err = (p - cls) * weight
        x.forEach((v, k) => {
          grad[k] += err * v
        })
        gradB += err
        loss += -weight * (cls * Math.log(p + 1e-12) + (1 - cls) * Math.log(1 - p + 1e-12))
      }
      const n = X.length
      for (let k = 0; k < dim; k++) {
        w[k] -= opts.lr * (grad[k] / n + opts.l2 * w[k])
      }
      b -= opts.lr * (gradB / n)
      const epoch = history.length + 1
      history.push({
        epoch,
        loss: loss / n,
        trainAcc: accuracyOn(X, y),
        testAcc: epoch % 5 === 0 ? accuracyOn(test.X, test.y) : null,
      })
    }
  }

  return { w, b, history, total: opts.epochs, step, isDone: () => history.length >= opts.epochs }
}

export function score(w: Float64Array, b: number, x: SparseVector): number {
  let z = b
  x.forEach((v, k) => {
    z += w[k] * v
  })
  return sigmoid(z)
}

export function evaluate(
  w: Float64Array,
  b: number,
  X: SparseVector[],
  y: number[],
  threshold = 0.5,
): Metrics {
  let tp = 0
  let fp = 0
  let tn = 0
  let fn = 0
  for (let i = 0; i < X.length; i++) {
    const pred = score(w, b, X[i]) >= threshold ? 1 : 0
    if (pred === 1 && y[i] === 1) tp++
    else if (pred === 1) fp++
    else if (y[i] === 0) tn++
    else fn++
  }
  const n = X.length
  const accuracy = n === 0 ? 0 : (tp + tn) / n
  const precision = tp + fp === 0 ? 0 : tp / (tp + fp)
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn)
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall)
  return { n, accuracy, precision, recall, f1, tp, fp, tn, fn }
}
