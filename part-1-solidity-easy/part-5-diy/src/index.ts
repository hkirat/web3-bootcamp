import express from 'express';
import Web3 from 'web3';

const app = express();
const port = 3000;


// Initialize Web3 with an Ethereum node URL
const web3 = new Web3('YOUR_ETHEREUM_NODE_URL');

// Define the ABI and contract address of the smart contract
// const contractAbi = [...]; // Replace with the ABI of your contract
// const contractAddress = '0x...'; // Replace with the address of your contract

// Create a contract instance
// const contract = new web3.eth.Contract(contractAbi, contractAddress);

// Define the event you want to listen to
const eventName = 'SuccessfullTxn'; // Replace with the actual event name





app.use(express.json());

app.post('/webhook', (req, res) => {
    // Check if the request payload matches the expected data format
    if (!req.body.eventData) {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    const eventData = req.body.eventData;

    // Handle the event data as needed
    console.log('Received event data:', eventData);

    // You can perform actions here based on the received event data

    res.json({ message: 'Webhook received and processed' });
});


app.listen(port, () => {
    console.log(`Backend Listenting on Port: ${port}`);
});


// Subscribe to the specified event
// contract.events[eventName]({}, (error, event) => {
//     if (!error) {
//         // Call the webhook when the event is triggered
//         // Adjust the URL to match your server's endpoint
//         fetch('http://localhost:3000/webhook', {
//             method: 'POST',
//             headers: { 'Content-Type': 'application/json' },
//             body: JSON.stringify({ eventData: event.returnValues }),
//         });
//     }
// });