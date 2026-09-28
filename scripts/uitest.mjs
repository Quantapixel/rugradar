/**
 * End-to-end check that the app works in a browser, not just that it renders.
 *
 * Drives the real UI over the Chrome DevTools Protocol: waits for training to
 * finish, switches views, clicks a sample, pastes source and lets auto-scan
 * fire, then fails if anything threw.
 *
 *   1) npm run dev
 *   2) google-chrome --headless=new --remote-debugging-port=9222 \
 *        --user-data-dir=/tmp/cdp http://127.0.0.1:5173/#scan
 *   3) node scripts/uitest.mjs
 */

const CDP = process.env.CDP_URL ?? 'http://127.0.0.1:9222'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function findPage() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const targets = await (await fetch(`${CDP}/json/list`)).json()
      const page = targets.find((target) => target.type === 'page' && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {
      /* chrome not up yet */
    }
    await sleep(250)
  }
  throw new Error(`no debuggable page at ${CDP}`)
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    this.errors = []
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const entry = this.pending.get(message.id)
        if (!entry) return
        this.pending.delete(message.id)
        if (message.error) entry.reject(new Error(JSON.stringify(message.error)))
        else entry.resolve(message.result)
        return
      }
      if (message.method === 'Runtime.exceptionThrown') {
        const details = message.params.exceptionDetails
        this.errors.push(details?.exception?.description ?? details?.text ?? 'exception')
      }
      if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
        this.errors.push(message.params.args.map((arg) => arg.value ?? arg.description ?? '').join(' '))
      }
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
}

const page = await findPage()
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})

const cdp = new Cdp(socket)
await cdp.send('Runtime.enable')

const evaluate = async (expression) => {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description ?? 'evaluation failed')
  }
  return result.result.value
}

const text = () => evaluate('document.body.innerText')

/* Headings are rendered with `text-transform: uppercase`, and innerText
   reflects that, so every heading match has to be case-insensitive. */
const has = (needle) => `/${needle}/i.test(document.body.innerText)`

const waitFor = async (expression, label, timeout = 25000) => {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await evaluate(expression)) return
    await sleep(200)
  }
  throw new Error(`timed out waiting for ${label}`)
}

const clickButton = (matcher) =>
  evaluate(
    `(() => {
       const needle = ${JSON.stringify(matcher.toLowerCase())};
       const b = [...document.querySelectorAll('button')].find((el) => el.textContent.trim().toLowerCase().includes(needle));
       if (!b) return false;
       b.click();
       return true;
     })()`,
  )

const results = []
const check = (name, ok, detail = '') => {
  results.push(ok)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
}

/* 1. boot + training */
await waitFor(`document.body.innerText.includes('Most rugs are visible')`, 'app shell')
await waitFor(`document.body.innerText.includes('model ready')`, 'training to finish')
check('page loads and the classifier finishes training', true)

/* 2. first verdict, unprompted */
const initial = await text()
check('a verdict is rendered without any interaction', /Hostile control patterns/.test(initial))
check('the attribution view is rendered', /where the model looked/i.test(initial))
check('the default sample is scored as hostile', /90\./.test(initial))

/* 3. view switching */
check('Model tab is clickable', await clickButton('model'))
await waitFor(has('training run'), 'model view')
const model = await text()
check(
  'Model view shows training, evaluation and vocabulary',
  /training run/i.test(model) && /evaluation/i.test(model) && /what it learned/i.test(model),
)
check('evaluation numbers are real, not placeholders', /100\.0%/.test(model) && /4\/5/.test(model))
check('Scan tab is clickable', await clickButton('scan'))
await waitFor(has('contract source'), 'scan view')
check('switching back to Scan works', true)

/* 4. clicking a sample re-scans */
const clicked = await clickButton('vanilla erc20')
check('sample chip is clickable', clicked)
await waitFor(`document.body.innerText.includes('No hostile patterns found')`, 'clean verdict after sample click')
check('clicking a clean sample flips the verdict to benign', true)

/* 5. pasting source triggers auto-scan */
const hostileSource = [
  'pragma solidity ^0.8.20;',
  'import "@openzeppelin/contracts/token/ERC20/ERC20.sol";',
  'import "@openzeppelin/contracts/access/Ownable.sol";',
  'contract Trap is ERC20, Ownable {',
  '    mapping(address => bool) public blacklisted;',
  '    uint256 public sellTax = 4;',
  '    function setBlacklisted(address account, bool value) external onlyOwner { blacklisted[account] = value; }',
  '    function setSellTax(uint256 t) external onlyOwner { sellTax = t; }',
  '    function destroy() external onlyOwner { selfdestruct(payable(owner())); }',
  '    function _transfer(address from, address to, uint256 amount) internal override {',
  '        require(!blacklisted[from] && !blacklisted[to], "blocked");',
  '        super._transfer(from, to, amount);',
  '    }',
  '}',
].join('\n')

const typed = await evaluate(
  `(() => {
     const el = document.querySelector('textarea');
     if (!el) return 'no textarea';
     const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
     setter.call(el, ${JSON.stringify(hostileSource)});
     el.dispatchEvent(new Event('input', { bubbles: true }));
     return el.value.length;
   })()`,
)
check('source can be typed into the editor', typeof typed === 'number' && typed > 200, `${typed} chars`)
await waitFor(`document.body.innerText.includes('Hostile control patterns')`, 'auto-scan after paste', 15000)
check('auto-scan scores pasted source without pressing anything', true)

/* 6. export does not throw */
await clickButton('export')
await sleep(600)
check('export button does not throw', cdp.errors.length === 0, cdp.errors[0] ?? '')

/* 7. nothing threw anywhere */
check('no uncaught errors in the console', cdp.errors.length === 0, cdp.errors.slice(0, 2).join(' | '))

const failed = results.filter((ok) => !ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
socket.close()
process.exit(failed === 0 ? 0 : 1)
