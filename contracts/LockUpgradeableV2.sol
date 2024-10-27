// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.27;

// Uncomment this line to use console.log
// import "hardhat/console.sol";

contract LockUpgradeableV2 {
    uint public unlockTime;
    address payable public owner;

    event Withdrawal(uint amount, uint when, uint left);

    function initialize(uint _unlockTime) public payable {
        require(
            block.timestamp < _unlockTime,
            "Unlock time should be in the future"
        );

        unlockTime = _unlockTime;
        owner = payable(tx.origin);
    }

    function withdraw(uint amount) public {
        // Uncomment this line, and the import of "hardhat/console.sol", to print a log in your terminal
        // console.log("Unlock time is %o and block timestamp is %o", unlockTime, block.timestamp);

        require(block.timestamp >= unlockTime, "You can't withdraw yet");
        require(msg.sender == owner, "You aren't the owner");

        owner.transfer(amount);

        emit Withdrawal(amount, block.timestamp, address(this).balance);
    }
}
