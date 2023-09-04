// SPDX-License-Identifier: MIT 
pragma solidity ^0.8.20;

contract CourseAccess {
    mapping(address => bool) public hasAccess;

    function acknowledgePayment(address user) external {
        require(hasAccess[user] == false, "User already has access");
        hasAccess[user] = true;
    }
}
