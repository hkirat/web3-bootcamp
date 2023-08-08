import {useEffect, useState} from "react";


export function Admin({web3, courseContract}) {
    const [payments, setPayments] = useState([]);

    const init = () => {
        if (!web3 || !courseContract) return;
        console.log(courseContract.methods.payments);

        courseContract.methods.getAllPayments().call()
            .then(values => {
                setPayments(values)
            });
    }

    useEffect(() => {
        if (web3 && courseContract) {
            init();
        }
    }, [web3, courseContract]);

    return (
        <div>
            <h1>Admin</h1>
            Total {payments.length} people have bought the course!
            {payments.map(payment => (
                <div key={payment.email}>
                    <p>Email: {payment.email}</p>
                </div>
            ))}
        </div>
    )
}