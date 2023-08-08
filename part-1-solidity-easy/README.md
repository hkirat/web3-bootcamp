
This folder contains the code for the first part of the complete solidity roadmap. 
In this series, we will be building a simple smart contract that allows us to store a string on the blockchain.
We're using [Crypto Zombies](https://cryptozombies.io/) as the learning platform and completing the Solidity basics series.

## Part 1: Solidity Basics
Here we go through [Module 1](https://cryptozombies.io/en/lesson/1/chapter/1) of the Crypto zombies course

## Part 2: Solidity Medium
Here we go through [Module 2](https://cryptozombies.io/en/lesson/1/chapter/2) of the Crypto zombies course

## Part 3: Advanced solidity concepts
Here we go through [Module 3](https://cryptozombies.io/en/lesson/1/chapter/3) of the Crypto zombies course

## Part 4: Payments in Solidity
Here we go through [Module 4](https://cryptozombies.io/en/lesson/1/chapter/4) of the Crypto zombies course

## Part 5: Building our own contract
Here we build our own Solidity contract to accept payments from a user. The project contains
 - A simple contract that accepts payments. It emits events anytime a user makes a payment
 - A frontend where a user can go, connect their wallet and make a payment. Once the payment is made, the user is given access to the course
 - A centralized backend that watches the contract, and anytime a payment is made, it gives the user access to the course
 - There is a problem with our backend, it can go down, and when it does it might miss events from the contract. Can you think of a way to fix this?
