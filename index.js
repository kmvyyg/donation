require('dotenv').config();
const express = require('express');
const { twiml } = require('twilio');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));

// In-memory store for SMS donation sessions
const smsSessions = {};

app.get('/', (req, res) => {
    res.send('Donation server is running.');
});

// Serve the donation web page
app.get('/donate', (req, res) => {
    res.sendFile(__dirname + '/donate.html');
});

// Webhook for incoming SMS
app.post('/sms', (req, res) => {
    const MessagingResponse = twiml.MessagingResponse;
    const response = new MessagingResponse();
    const from = req.body.From;
    const body = (req.body.Body || '').trim();

    // Check if we have a session for this number
    const session = smsSessions[from] || {};

    if (!session.step) {
        // Step 1: Expecting amount
        const amountMatch = body.match(/\$?([0-9]+(\.[0-9]{1,2})?)/);
        if (amountMatch) {
            session.amount = amountMatch[1];
            session.step = 'cc';
            smsSessions[from] = session;
            response.message(`Thank you! Please reply with your credit card number (no spaces or dashes).`);
        } else {
            response.message('Please reply with the amount you wish to donate (e.g., 10 or $10).');
        }
    } else if (session.step === 'cc') {
        // Step 2: Expecting credit card number
        const cc = body.replace(/\D/g, '');
        if (/^[0-9]{15,16}$/.test(cc)) {
            session.cc = cc;
            session.step = 'exp';
            smsSessions[from] = session;
            response.message('Please reply with the expiration date (MMYY).');
        } else {
            response.message('Invalid credit card number. Please reply with a valid 15 or 16 digit card number.');
        }
    } else if (session.step === 'exp') {
        // Step 3: Expecting expiration date
        if (/^[0-9]{4}$/.test(body)) {
            session.exp = body;
            session.step = 'cvv';
            smsSessions[from] = session;
            response.message('Please reply with the CVV (3 or 4 digits).');
        } else {
            response.message('Invalid expiration date. Please reply with 4 digits (MMYY).');
        }
    } else if (session.step === 'cvv') {
        // Step 4: Expecting CVV
        if (/^[0-9]{3,4}$/.test(body)) {
            session.cvv = body;
            session.step = 'zip';
            smsSessions[from] = session;
            response.message('Please reply with your 5 digit ZIP code.');
        } else {
            response.message('Invalid CVV. Please reply with 3 or 4 digits.');
        }
    } else if (session.step === 'zip') {
        // Step 5: Expecting ZIP
        if (/^[0-9]{5}$/.test(body)) {
            session.zip = body;
            // Process payment
            const fetch = require('node-fetch');
            const apiKey = process.env.CARDKNOX_API_KEY;
            const cleanPhone = from.replace(/\D/g, '');
            const cardknoxPayload = {
                xKey: apiKey,
                xVersion: '4.5.6',
                xSoftwareVersion: '4.5.6',
                xSoftwareName: 'DonationSMS',
                xCommand: 'cc:sale',
                xAmount: session.amount,
                xCardNum: session.cc,
                xExp: session.exp,
                xCVV: session.cvv,
                xZip: session.zip,
                xPhone: cleanPhone
            };
            fetch('https://x1.cardknox.com/gatewayjson', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(cardknoxPayload)
            })
                .then(async r => {
                    let result;
                    try { result = await r.json(); } catch (e) { result = null; }
                    if (result && result.xResult === 'A') {
                        response.message(`Thank you! Your donation of $${session.amount} was successful. Ref: ${result.xRefNum || 'N/A'}`);
                    } else {
                        response.message('Sorry, there was an error processing your donation. Please try again.');
                    }
                    delete smsSessions[from];
                    res.type('text/xml');
                    res.send(response.toString());
                })
                .catch(e => {
                    response.message('Sorry, there was a network error processing your donation.');
                    delete smsSessions[from];
                    res.type('text/xml');
                    res.send(response.toString());
                });
            return;
        } else {
            response.message('Invalid ZIP code. Please reply with your 5 digit ZIP code.');
        }
    }
    res.type('text/xml');
    res.send(response.toString());
});

// Webhook for incoming calls
app.post('/voice', (req, res) => {
    const VoiceResponse = twiml.VoiceResponse;
    const response = new VoiceResponse();
    response.say('Hello from your donation server.');
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
        action: `/process-exp?amount=<span class="math-inline">\{amount\}&cc\=</span>{cc}`,
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
            action: `/process-exp?amount=<span class="math-inline">\{amount\}&cc\=</span>{cc}`,
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
        action: `/process-cvv?amount=<span class="math-inline">\{amount\}&cc\=</span>{cc}&exp=${exp}`,
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
        action: `/process-zip?amount=<span class="math-inline">\{amount\}&cc\=</span>{cc}&exp=<span class="math-inline">\{exp\}&cvv\=</span>{cvv}`,
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
});
app.listen(3000, () => {
  console.log('Server running on port 3000');
});
