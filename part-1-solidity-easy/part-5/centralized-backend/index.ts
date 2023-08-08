import Web3 from 'web3';
import axios from 'axios';
import { abi } from "./abi";

const providerUrl = "wss://eth-goerli.g.alchemy.com/v2/u4LDb5PsjbhInoG7S5LHLHzYe85f2pU1";
const contractAddress = "0x83cdb6ed4915be70805afb3dfeba6a1a677d1bfb";
const webhookUrl = "https://your-dummy-fetch-url";

const web3 = new Web3(new Web3.providers.WebsocketProvider(providerUrl));
const contract = new web3.eth.Contract(abi, contractAddress);

//@ts-ignore
contract.events.PaymentReceived({
    fromBlock: 0
})
.on('data', async function(event) {
    console.log(`Adding user ${event.returnValues.email} to the course`);
    // axios.post(webhookUrl, {
    //     email: event.returnValues.email,
    // });
})
