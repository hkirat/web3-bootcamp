// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "./ownable.sol";

abstract contract CourseContract is Ownable {
    
    uint courseFee;

    event SuccessfullTxn(address indexed sender, string _email, uint _phone);

    function setCourseFee(uint _fee) external onlyOwner() {
        courseFee = _fee;
    }

    constructor(uint _fee) {
        courseFee = _fee;
    }

    function transaction(uint _phone, string calldata _email) external payable {
        require(msg.value == courseFee, "Incorrect Ether Amount");
        emit SuccessfullTxn(msg.sender, _email, _phone);
    }
}
