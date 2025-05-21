# Node.js Twilio Phone & SMS Donation Webhook

This project is a Node.js server designed to handle Twilio phone calls and SMS messages for donation purposes using webhooks.

## Features
- Receives and responds to Twilio phone calls (voice webhooks)
- Handles incoming SMS for donations
- Easily extendable for payment integration (e.g., Stripe)

## Getting Started
1. Install dependencies:
   ```powershell
   npm install
   ```
2. Create a `.env` file with your Twilio credentials (to be added in setup steps).
3. Start the server:
   ```powershell
   node index.js
   ```

## Next Steps
- Implement webhook endpoints for Twilio voice and SMS
- Configure your Twilio number to use your webhook URLs
- (Optional) Integrate a payment processor

---

For more details, see the project instructions or ask for the next step!
