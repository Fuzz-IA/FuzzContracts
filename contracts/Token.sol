// SPDX-License-Identifier: MIT
// Compatible with OpenZeppelin Contracts ^5.0.0
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract Token is ERC20, Ownable, ERC20Permit {
    constructor(address initialOwner)
        ERC20("FDemoToken", "Fdemo")
        Ownable()
        ERC20Permit("FDemo")
    {
    }

    function mint() public {
        _mint(msg.sender, 10000000 * 10**decimals());
    }
}