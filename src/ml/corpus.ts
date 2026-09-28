/**
 * Synthetic training corpus.
 *
 * Labelled data for "is this token contract hostile to holders?" does not exist
 * as an open dataset, so this module generates one by composing real patterns
 * observed in ERC-20 tokens: OpenZeppelin-style baseline code, distractors that
 * look scary but are safely capped, and hostile patterns that hand the owner
 * unbounded control.
 *
 * The generator deliberately varies identifiers, ordering, formatting and
 * supply numbers so a model cannot win by memorising one template.
 */

import { type Rng, chance, pick, randInt } from './rng.ts'

export type Sample = {
  id: string
  source: string
  label: 0 | 1
  kind: string
  origin: 'synthetic' | 'handwritten'
}

const NAMES = ['Aurora', 'Nexus', 'Vertex', 'Helios', 'Zenith', 'Orbit', 'Pulse', 'Nova', 'Kappa', 'Solaris', 'Lumen', 'Quanta']
const SUFFIX = ['Token', 'Coin', 'Finance', 'Protocol', 'Network', '']
const SYMS = ['AUR', 'NXS', 'VTX', 'HEL', 'ZEN', 'ORB', 'PLS', 'NVA', 'KPA', 'SOL', 'LMN', 'QNT']

/**
 * Identifier pools shared by *both* classes.
 *
 * This matters more than it looks. If benign contracts consistently name a
 * parameter `newFee` while hostile ones name it `account`, a linear model wins
 * by memorising our naming habits, reports 99% accuracy, then falls apart on
 * real code. Sampling names from shared pools removes that shortcut and forces
 * the model onto security-relevant vocabulary (`blacklist`, `cap`,
 * `selfdestruct`, `tx` + `origin`).
 */
const ADDR_PARAMS = ['account', 'who', 'addr', 'user', 'target', 'wallet', 'holder']
const AMOUNT_PARAMS = ['amount', 'value', 'amt', 'quantity', 'tokens']
const RECEIVER_PARAMS = ['treasury', 'marketingWallet', 'feeCollector', 'teamWallet', 'feeReceiver', 'feeSink']

type Fragment = {
  kind: string
  state: string[]
  code: string[]
  checks: string[]
  taxVar?: string
  receiverVar?: string
}

/* ------------------------------------------------------------------ */
/* benign / safely-capped patterns                                     */
/* ------------------------------------------------------------------ */

function fragCappedFee(rng: Rng): Fragment {
  const feeVar = pick(rng, ['feeBps', 'tradeFee', '_feeBps'])
  const maxConst = pick(rng, ['MAX_FEE', 'FEE_CAP', 'MAX_TOTAL_FEE'])
  const receiver = pick(rng, RECEIVER_PARAMS)
  const feeParam = pick(rng, ['newFee', 'fee', 'bps', 'value'])
  const recvParam = pick(rng, ADDR_PARAMS)
  return {
    kind: 'capped-fee',
    state: [
      `    uint256 public constant ${maxConst} = ${pick(rng, ['500', '300', '250'])};`,
      `    uint256 public ${feeVar} = ${pick(rng, ['100', '50', '25'])};`,
      `    address public ${receiver};`,
    ],
    code: [
      `    function setFee(uint256 ${feeParam}) external onlyOwner {`,
      `        require(${feeParam} <= ${maxConst}, "fee above cap");`,
      `        ${feeVar} = ${feeParam};`,
      '    }',
      '',
      `    function setTreasury(address ${recvParam}) external onlyOwner {`,
      `        require(${recvParam} != address(0), "zero address");`,
      `        ${receiver} = ${recvParam};`,
      '    }',
    ],
    checks: [],
    taxVar: feeVar,
    receiverVar: receiver,
  }
}

function fragCappedMint(rng: Rng): Fragment {
  const capVar = pick(rng, ['MAX_SUPPLY', 'SUPPLY_CAP', 'HARD_CAP'])
  const cap = pick(rng, ['1_000_000_000', '500_000_000', '2_000_000_000'])
  const toParam = pick(rng, ADDR_PARAMS)
  const amountParam = pick(rng, AMOUNT_PARAMS)
  return {
    kind: 'capped-mint',
    state: [`    uint256 public constant ${capVar} = ${cap} * 10 ** 18;`],
    code: [
      `    function mint(address ${toParam}, uint256 ${amountParam}) external onlyOwner {`,
      `        require(totalSupply() + ${amountParam} <= ${capVar}, "supply cap reached");`,
      `        _mint(${toParam}, ${amountParam});`,
      '    }',
    ],
    checks: [],
  }
}

function fragBurn(): Fragment {
  return {
    kind: 'burn',
    state: [],
    code: [
      '    function burn(uint256 amount) external {',
      '        _burn(msg.sender, amount);',
      '    }',
    ],
    checks: [],
  }
}

function fragTimelock(rng: Rng): Fragment {
  const delay = pick(rng, ['2 days', '1 days', '3 days'])
  const newOwnerParam = pick(rng, ['newOwner', 'owner', 'admin', 'who'])
  return {
    kind: 'timelock',
    state: [
      '    address public pendingOwner;',
      '    uint256 public pendingOwnerSetAt;',
    ],
    code: [
      `    function transferOwnership(address ${newOwnerParam}) public override onlyOwner {`,
      `        pendingOwner = ${newOwnerParam};`,
      '        pendingOwnerSetAt = block.timestamp;',
      '    }',
      '',
      '    function acceptOwnership() external {',
      `        require(block.timestamp >= pendingOwnerSetAt + ${delay}, "timelock active");`,
      '        require(msg.sender == pendingOwner, "not pending owner");',
      '        _transferOwnership(pendingOwner);',
      '    }',
    ],
    checks: [],
  }
}

/**
 * Benign contracts need loops and generic identifier names too, otherwise the
 * model happily learns "has a for-loop" => rug.
 */
function fragAirdrop(rng: Rng): Fragment {
  const listParam = pick(rng, ['recipients', 'accounts', 'holders', 'targets'])
  const amountParam = pick(rng, AMOUNT_PARAMS)
  return {
    kind: 'airdrop',
    state: [],
    code: [
      `    function airdrop(address[] calldata ${listParam}, uint256 ${amountParam}) external onlyOwner {`,
      `        for (uint256 i = 0; i < ${listParam}.length; i++) {`,
      `            _transfer(msg.sender, ${listParam}[i], ${amountParam});`,
      '        }',
      '    }',
    ],
    checks: [],
  }
}

/* ------------------------------------------------------------------ */
/* hostile patterns                                                    */
/* ------------------------------------------------------------------ */

function fragBlacklist(rng: Rng): Fragment {
  const map = pick(rng, ['blacklisted', 'isBlacklisted', 'blockedAccounts', 'bots', '_blocklist'])
  const setter = pick(rng, ['setBlacklisted', 'updateBlacklist', 'setBlocked', 'banAddress'])
  const target = pick(rng, ADDR_PARAMS)
  return {
    kind: 'blacklist',
    state: [`    mapping(address => bool) public ${map};`],
    code: [
      `    function ${setter}(address ${target}, bool value) external onlyOwner {`,
      `        ${map}[${target}] = value;`,
      '    }',
    ],
    checks: [`require(!${map}[from] && !${map}[to], "address blocked");`],
  }
}

function fragMutableFee(rng: Rng): Fragment {
  const buyVar = pick(rng, ['buyFee', '_buyTax', 'buyTaxFee'])
  const sellVar = pick(rng, ['sellFee', '_sellTax', 'sellTaxFee'])
  const taxVar = pick(rng, ['_taxFee', 'totalFee', 'swapFee'])
  const setter = pick(rng, ['setFees', 'updateTaxes', 'setTax', 'setFeesAndWallet'])
  const receiver = pick(rng, RECEIVER_PARAMS)
  const buyParam = pick(rng, ['newBuy', 'buy', 'value'])
  const sellParam = pick(rng, ['newSell', 'sell', 'value'])
  const recvParam = pick(rng, ADDR_PARAMS)
  // A minority ship a nominal cap that still permits 100% (10_000 bps). That is
  // a real pattern, and it is deliberately a false-negative trap for the model.
  const fakeCap = chance(rng, 0.2)
  return {
    kind: fakeCap ? 'mutable-fee+fake-cap' : 'mutable-fee',
    state: [
      `    uint256 public ${buyVar} = ${randInt(rng, 1, 10)};`,
      `    uint256 public ${sellVar} = ${randInt(rng, 1, 10)};`,
      `    address public ${receiver};`,
    ],
    code: fakeCap
      ? [
          `    function ${setter}(uint256 ${buyParam}, uint256 ${sellParam}) external onlyOwner {`,
          `        require(${buyParam} <= 10_000 && ${sellParam} <= 10_000, "invalid");`,
          `        ${buyVar} = ${buyParam};`,
          `        ${sellVar} = ${sellParam};`,
          '    }',
          '',
          `    function setMarketingWallet(address ${recvParam}) external onlyOwner {`,
          `        ${receiver} = ${recvParam};`,
          '    }',
        ]
      : [
          `    function ${setter}(uint256 ${buyParam}, uint256 ${sellParam}) external onlyOwner {`,
          `        ${buyVar} = ${buyParam};`,
          `        ${sellVar} = ${sellParam};`,
          '    }',
          '',
          `    function setMarketingWallet(address ${recvParam}) external onlyOwner {`,
          `        ${receiver} = ${recvParam};`,
          '    }',
        ],
    checks: [],
    taxVar,
    receiverVar: receiver,
  }
}

function fragTradingGate(rng: Rng): Fragment {
  const flag = pick(rng, ['tradingEnabled', 'tradingActive', '_tradingOpen'])
  const setter = pick(rng, ['enableTrading', 'openTrading', 'startTrading'])
  const excl = pick(rng, ['isExcludedFromFee', 'isExcluded', '_excluded'])
  const who = pick(rng, ADDR_PARAMS)
  return {
    kind: 'trading-gate',
    state: [`    bool public ${flag} = false;`, `    mapping(address => bool) public ${excl};`],
    code: [
      `    function ${setter}() external onlyOwner {`,
      `        ${flag} = true;`,
      '    }',
      '',
      `    function excludeFromFee(address ${who}, bool value) external onlyOwner {`,
      `        ${excl}[${who}] = value;`,
      '    }',
    ],
    checks: [`require(${flag} || ${excl}[from] || ${excl}[to], "trading is not open");`],
  }
}

function fragLimits(rng: Rng): Fragment {
  const maxTx = pick(rng, ['maxTxAmount', '_maxTxAmount', 'maxTransactionAmount'])
  const maxWallet = pick(rng, ['maxWalletAmount', '_maxWallet', 'walletLimit'])
  const sellLimit = pick(rng, ['maxSellAmount', '_maxSell', 'sellLimit'])
  const amountParam = pick(rng, ['amount', 'value', 'amt'])
  return {
    kind: 'trade-limits',
    state: [
      `    uint256 public ${maxTx} = ${randInt(rng, 1, 5)}_000_000 * 10 ** 18;`,
      `    uint256 public ${maxWallet} = ${randInt(rng, 6, 20)}_000_000 * 10 ** 18;`,
      `    uint256 public ${sellLimit} = ${randInt(rng, 1, 3)}_000_000 * 10 ** 18;`,
      '    address public pancakePair;',
    ],
    code: [
      `    function setMaxTxAmount(uint256 ${amountParam}) external onlyOwner {`,
      `        ${maxTx} = ${amountParam};`,
      '    }',
      '',
      `    function setMaxWalletAmount(uint256 ${amountParam}) external onlyOwner {`,
      `        ${maxWallet} = ${amountParam};`,
      '    }',
    ],
    checks: [
      `require(amount <= ${maxTx}, "amount exceeds max tx");`,
      `require(to == pancakePair || balanceOf(to) + amount <= ${maxWallet}, "wallet limit");`,
    ],
  }
}

function fragCooldown(rng: Rng): Fragment {
  const map = pick(rng, ['_lastTrade', 'lastBuyTime', '_cooldownEnd'])
  const windowParam = pick(rng, ['newCooldown', 'cooldown', 'seconds_', 'window'])
  return {
    kind: 'cooldown',
    state: [`    mapping(address => uint256) private ${map};`, '    uint256 public cooldownTime = 60;'],
    code: [
      `    function setCooldown(uint256 ${windowParam}) external onlyOwner {`,
      `        cooldownTime = ${windowParam};`,
      '    }',
    ],
    checks: [`require(block.timestamp >= ${map}[from] + cooldownTime, "cooldown active");`],
  }
}

function fragOwnerMint(rng: Rng): Fragment {
  const toParam = pick(rng, ADDR_PARAMS)
  const amountParam = pick(rng, AMOUNT_PARAMS)
  const listParam = pick(rng, ['accounts', 'recipients', 'targets', 'holders'])
  return {
    kind: 'unbounded-mint',
    state: [],
    code: [
      `    function mint(address ${toParam}, uint256 ${amountParam}) external onlyOwner {`,
      `        _mint(${toParam}, ${amountParam});`,
      '    }',
      '',
      `    function batchMint(address[] calldata ${listParam}, uint256 ${amountParam}) external onlyOwner {`,
      `        for (uint256 i = 0; i < ${listParam}.length; i++) {`,
      `            _mint(${listParam}[i], ${amountParam});`,
      '        }',
      '    }',
    ],
    checks: [],
  }
}

function fragSeize(rng: Rng): Fragment {
  const fn = pick(rng, ['seize', 'forceTransfer', 'recoverTokens'])
  const who = pick(rng, ADDR_PARAMS)
  const amountParam = pick(rng, AMOUNT_PARAMS)
  return {
    kind: 'owner-seize',
    state: [],
    code: [
      `    function ${fn}(address ${who}, uint256 ${amountParam}) external onlyOwner {`,
      `        _transfer(${who}, owner(), ${amountParam});`,
      '    }',
    ],
    checks: [],
  }
}

function fragProxy(rng: Rng): Fragment {
  const slot = pick(rng, ['implementation', '_implementation', 'logic'])
  return {
    kind: 'upgradeable',
    state: [`    address public ${slot};`],
    code: [
      `    function upgradeTo(address newImplementation) external onlyOwner {`,
      `        ${slot} = newImplementation;`,
      '    }',
      '',
      '    fallback() external payable {',
      `        address impl = ${slot};`,
      '        assembly {',
      '            calldatacopy(0, 0, calldatasize())',
      '            let result := delegatecall(gas(), impl, 0, calldatasize(), 0, 0)',
      '            returndatacopy(0, 0, returndatasize())',
      '            switch result',
      '            case 0 { revert(0, returndatasize()) }',
      '            default { return(0, returndatasize()) }',
      '        }',
      '    }',
    ],
    checks: [],
  }
}

function fragSelfDestruct(rng: Rng): Fragment {
  const fn = pick(rng, ['emergencyShutdown', 'destroyContract', 'rugPull'])
  return {
    kind: 'selfdestruct',
    state: [],
    code: [
      `    function ${fn}() external onlyOwner {`,
      '        selfdestruct(payable(owner()));',
      '    }',
    ],
    checks: [],
  }
}

function fragBotGuard(rng: Rng): Fragment {
  const delay = randInt(rng, 3, 30)
  return {
    kind: 'tx-origin-guard',
    state: ['    uint256 public launchBlock;'],
    code: [
      '    function _antiBot() internal view {',
      '        require(tx.origin == msg.sender, "contracts are not allowed");',
      `        require(block.number > launchBlock + ${delay}, "too early");`,
      '    }',
    ],
    checks: ['_antiBot();'],
  }
}

const BENIGN_FRAGMENTS = [fragCappedFee, fragCappedMint, fragBurn, fragTimelock, fragAirdrop]
const HOSTILE_FRAGMENTS = [
  fragBlacklist,
  fragMutableFee,
  fragTradingGate,
  fragLimits,
  fragCooldown,
  fragOwnerMint,
  fragSeize,
  fragProxy,
  fragSelfDestruct,
  fragBotGuard,
]

/* ------------------------------------------------------------------ */
/* assembly                                                            */
/* ------------------------------------------------------------------ */

function transferOverride(
  checks: string[],
  taxVar: string | undefined,
  receiverVar: string | undefined,
  amountParam: string,
): string[] {
  if (checks.length === 0 && !taxVar) return []
  const body: string[] = []
  for (const check of checks) body.push(`        ${check.replace(/\bamount\b/g, amountParam)}`)
  if (taxVar) {
    body.push(`        uint256 fee = (${amountParam} * ${taxVar}) / 10_000;`)
    body.push(`        uint256 net = ${amountParam} - fee;`)
    body.push('        super._transfer(from, to, net);')
    body.push(`        if (fee > 0) super._transfer(from, ${receiverVar ?? 'owner()'}, fee);`)
  } else {
    body.push(`        super._transfer(from, to, ${amountParam});`)
  }
  return [
    `    function _transfer(address from, address to, uint256 ${amountParam}) internal override {`,
    ...body,
    '    }',
  ]
}

export function buildSyntheticToken(rng: Rng, isHostile: boolean, index: number): Sample {
  const name = pick(rng, NAMES) + pick(rng, SUFFIX)
  const sym = pick(rng, SYMS)
  const ownable = isHostile ? true : chance(rng, 0.6)

  const chunks: Fragment[] = []
  if (isHostile) {
    // Most hostile tokens stack several powers; a minority are subtle.
    const count = chance(rng, 0.18) ? 1 : randInt(rng, 2, 4)
    const pool = [...HOSTILE_FRAGMENTS]
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(rng() * pool.length)
      chunks.push(pool.splice(idx, 1)[0](rng))
    }
  } else if (ownable) {
    const count = randInt(rng, 1, 2)
    const pool = [...BENIGN_FRAGMENTS]
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(rng() * pool.length)
      chunks.push(pool.splice(idx, 1)[0](rng))
    }
  }

  const state = chunks.flatMap((c) => c.state)
  const code = chunks.flatMap((c) => (c.code.length > 0 ? [...c.code, ''] : []))
  const checks = chunks.flatMap((c) => c.checks)
  const taxVar = chunks.find((c) => c.taxVar)?.taxVar
  const receiverVar = chunks.find((c) => c.receiverVar)?.receiverVar
  const amountParam = pick(rng, ['amount', 'value', 'amt', 'tokens'])

  const supply = pick(rng, ['1_000_000_000', '100_000_000', '21_000_000', '500_000_000'])
  const lines: string[] = []
  lines.push('// SPDX-License-Identifier: MIT')
  lines.push(`pragma solidity ^0.8.${pick(rng, ['19', '20', '24'])};`)
  lines.push('')
  lines.push('import "@openzeppelin/contracts/token/ERC20/ERC20.sol";')
  if (ownable) lines.push('import "@openzeppelin/contracts/access/Ownable.sol";')
  lines.push('')
  lines.push(`contract ${name} is ERC20${ownable ? ', Ownable' : ''} {`)
  if (state.length > 0) {
    lines.push(...state)
    lines.push('')
  }
  lines.push(`    constructor() ERC20("${name}", "${sym}")${ownable ? ' Ownable(msg.sender)' : ''} {`)
  lines.push(`        _mint(msg.sender, ${supply} * 10 ** decimals());`)
  lines.push('    }')
  if (code.length > 0) {
    lines.push('')
    lines.push(...code.filter((line, i) => !(line === '' && code[i - 1] === '')))
  }
  const override = transferOverride(checks, taxVar, receiverVar, amountParam)
  if (override.length > 0) {
    lines.push('')
    lines.push(...override)
  }
  lines.push('}')

  return {
    id: `syn-${index}`,
    source: lines.join('\n'),
    label: isHostile ? 1 : 0,
    kind: chunks.map((c) => c.kind).filter(Boolean).join('+') || 'plain-erc20',
    origin: 'synthetic',
  }
}

export function generateCorpus(size: number, seed: number): Sample[] {
  const rng: Rng = (() => {
    // Local import-free copy keeps this module usable from the corpus generator
    // without threading the RNG through every call site.
    let a = seed >>> 0
    return () => {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  })()
  const out: Sample[] = []
  for (let i = 0; i < size; i++) {
    out.push(buildSyntheticToken(rng, i % 2 === 0, i))
  }
  return out
}
