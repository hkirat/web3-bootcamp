import { useState, useEffect } from 'react'
import './App.css'
import { BrowserRouter, Routes, Route } from "react-router-dom";
import {contractABI} from "./abi";
import {Admin} from "./Admin";
import {CourseRegistration} from "./CourseRegistration";

function App() {
    const [web3, setWeb3] = useState(null);
    const [courseContract, setCourseContract] = useState(null);
    const [courseFee, setCourseFee] = useState('');
    const contractAddress = '0xac77ae1a44603f5455dadfa07cbcd068fcee9452';

    useEffect(() => {
        if (window.ethereum) {
            window.ethereum.request({ method: 'eth_requestAccounts' })
                .then(() => {
                    const web3Instance = new Web3(window.ethereum);
                    setWeb3(web3Instance);

                    const courseInstance = new web3Instance.eth.Contract(contractABI, contractAddress);
                    setCourseContract(courseInstance);

                    courseInstance.methods.courseFee().call()
                        .then(fee => {
                            setCourseFee(web3Instance.utils.fromWei(fee, 'ether'));
                        });
                })
                .catch(err => {
                    // Handle error if the user rejects the connection request
                    console.error(err);
                });
        } else {
            alert('Please install an another Ethereum wallet.');
        }
    }, []);

    return (
        <BrowserRouter>
            <Routes>
                <Route index element={<CourseRegistration web3={web3} courseContract={courseContract} courseFee={courseFee} />} />
                <Route path="admin" element={<Admin web3={web3} courseContract={courseContract} courseFee={courseFee} />} />
            </Routes>
        </BrowserRouter>
    )
}

export default App
