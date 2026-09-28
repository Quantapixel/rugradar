/**
 * Hand-written, out-of-distribution evaluation set.
 *
 * These contracts were authored by hand rather than emitted by the generator,
 * so they exercise the model on source it has genuinely never seen — including
 * naming and formatting it was not trained on. They are excluded from training
 * and reported separately, because a held-out split of the generator only
 * proves the model fits the generator.
 */

import type { Sample } from './corpus.ts'

export const HANDWRITTEN: Sample[] = [
  {
    id: 'ood-vanilla',
    origin: 'handwritten',
    label: 0,
    kind: 'vanilla-erc20',
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// A plain fixed-supply token. There is no owner and therefore no admin power.
contract Coffee is ERC20 {
    constructor() ERC20("Coffee", "BEAN") {
        _mint(msg.sender, 21_000_000e18);
    }
}
`,
  },
  {
    id: 'ood-honeypot',
    origin: 'handwritten',
    label: 1,
    kind: 'handwritten-honeypot',
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MoonShot is ERC20, Ownable {
    mapping(address => bool) private _blocked;
    uint256 public sellTax = 3;
    address public router;

    constructor() ERC20("Moon Shot", "MOON") Ownable(msg.sender) {
        _mint(msg.sender, 1e27);
    }

    function setRouter(address r) external onlyOwner {
        router = r;
    }

    function setSellTax(uint256 t) external onlyOwner {
        sellTax = t;
    }

    function blockAccount(address who, bool blocked) external onlyOwner {
        _blocked[who] = blocked;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        require(!_blocked[from] && !_blocked[to], "blocked");
        if (to == router) {
            uint256 tax = (amount * sellTax) / 100;
            super._transfer(from, owner(), tax);
            super._transfer(from, to, amount - tax);
        } else {
            super._transfer(from, to, amount);
        }
    }
}
`,
  },
  {
    id: 'ood-capped',
    origin: 'handwritten',
    label: 0,
    kind: 'handwritten-capped-fee',
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Merchant is ERC20, Ownable {
    uint256 public constant MAX_FEE_BPS = 200;
    uint256 public feeBps = 50;
    address public feeCollector;

    event FeeUpdated(uint256 newFee);

    constructor(address collector) ERC20("Merchant", "MRCH") Ownable(msg.sender) {
        require(collector != address(0), "collector required");
        feeCollector = collector;
        _mint(msg.sender, 100_000_000e18);
    }

    function setFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE_BPS, "fee above maximum");
        feeBps = newFee;
        emit FeeUpdated(newFee);
    }

    function collectFee(uint256 amount) internal returns (uint256) {
        return (amount * feeBps) / 10_000;
    }
}
`,
  },
  {
    id: 'ood-mintable',
    origin: 'handwritten',
    label: 1,
    kind: 'handwritten-unbounded-mint',
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Elastic is ERC20, Ownable {
    bool public tradingEnabled;

    constructor() ERC20("Elastic", "ELAS") Ownable(msg.sender) {
        _mint(msg.sender, 1_000_000e18);
    }

    function enableTrading() external onlyOwner {
        tradingEnabled = true;
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function burnFrom(address from, uint256 amount) external onlyOwner {
        _burn(from, amount);
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        require(tradingEnabled || from == owner() || to == owner(), "trading disabled");
        super._transfer(from, to, amount);
    }
}
`,
  },
  {
    id: 'ood-fake-cap',
    origin: 'handwritten',
    label: 1,
    kind: 'handwritten-fake-cap',
    source: `// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract StableYield is ERC20, Ownable {
    uint256 public constant MAX_FEE = 10_000;
    uint256 public feeBps = 300;
    mapping(address => uint256) private lastTransferAt;

    constructor() ERC20("Stable Yield", "SYLD") Ownable(msg.sender) {
        _mint(msg.sender, 100_000_000e18);
    }

    function updateFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE, "fee too high");
        feeBps = newFee;
    }

    function _transfer(address from, address to, uint256 amount) internal override {
        require(block.timestamp >= lastTransferAt[from] + 1 hours, "slow down");
        lastTransferAt[from] = block.timestamp;
        uint256 fee = (amount * feeBps) / 10_000;
        super._transfer(from, to, amount - fee);
        if (fee > 0) super._transfer(from, owner(), fee);
    }
}
`,
  },
]
