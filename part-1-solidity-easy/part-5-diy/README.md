
### Accept payments and do a web2 task, send ack back to the contract
You have an existing web2 system which gives the user a service when they pay for your product.
For example, you have a course on your website, and you want to gate access to the course based on who has paid for it.
You want to accept payments in crypto, and give access to the course when the user pays.
For the scope of this assignment, you should consider `giving access to the course` to be a simple webhook that you have to hit with a secret with the users email, and that would give the user access to the course

Write a contract where
 - A user can send some pre-defined admin defined ether to the contract
 - The contract emits an event when the user sends the ether
 - This event should be monitored by a web2 backend which will give the user access to the course (by calling the webhook)
 - When this task succeeds, the web2 backend should call the contract back to `ack` the payment, which means the user has been given access to the course

### Hard todo
In the real world your centralized backend could be down when the user makes a payment, and the user would not get access to the course.
Implement a cron job that runs every few minutes and sweeps all the non-acked payments, adds the user to the course and acks the payment



