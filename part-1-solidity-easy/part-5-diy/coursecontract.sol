// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract BasicContract {
    // State variables
    address public owner;
    uint256 public value;

    // Constructor
    constructor() {
        owner = msg.sender;
        value = 0;
    }

    // Function to update the value
    function updateValue(uint256 newValue) public {
        require(msg.sender == owner, "Only the owner can update the value");
        value = newValue;
    }
}
