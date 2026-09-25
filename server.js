const express = require('express');
const { pack } = require('msgpackr');
const WebSocket = require('ws');

const app = express();
app.use(express.json({ limit: '50mb' }));

const FISH_API_KEY = process.env.FISH_API_KEY;

// --- FISH SPEECH TTS ROUTE ---
app.post('/tts', async (req, res) => {
    try {
        const apiKey = req.headers.authorization?.replace('Bearer ', '') || FISH_API_KEY;
        if (!apiKey) {
            return res.status(401).json({ success: false, error: "Missing Fish Audio API Key." });
        }

        const { text, voiceId, sampleRate = 44100, model = "s2.1-pro-free" } = req.body;
        if (!text) {
            return res.status(400).json({ success: false, error: "Text is required for synthesis." });
        }

        const ws = new WebSocket('wss://api.fish.audio/v1/tts/live', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'model': model
            }
        });

        const audioChunks = [];

        ws.on('open', () => {
            const startMsg = {
                event: 'start',
                request: {
                    text: '',
                    format: 'pcm',
                    sample_rate: sampleRate,
                    latency: 'balanced',
                    ...(voiceId ? { reference_id: voiceId } : {})
                }
            };
            ws.send(pack(startMsg));
            ws.send(pack({ event: 'text', text: text }));
            ws.send(pack({ event: 'flush' }));
            ws.send(pack({ event: 'stop' }));
        });

        ws.on('message', (data) => {
            if (Buffer.isBuffer(data)) {
                audioChunks.push(data);
            }
        });

        ws.on('close', () => {
            const completeAudioBuffer = Buffer.concat(audioChunks);
            res.json({
                success: true,
                audioBase64: completeAudioBuffer.toString('base64')
            });
        });

        ws.on('error', (err) => {
            console.error("Fish Audio WebSocket error:", err);
            if (!res.headersSent) {
                res.status(500).json({ success: false, error: err.message });
            }
        });

    } catch (err) {
        console.error("TTS Proxy error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// --- FISH AUDIO MODEL CREATION ROUTE ---
app.post('/model/create', async (req, res) => {
    try {
        const apiKey = req.headers.authorization?.replace('Bearer ', '') || FISH_API_KEY;
        if (!apiKey) {
            return res.status(401).json({ success: false, error: "Missing Fish Audio API Key." });
        }

        const { name, pcmBase64, sampleRate = 44100 } = req.body;
        if (!name || !pcmBase64) {
            return res.status(400).json({ success: false, error: "Name and PCM audio are required." });
        }

        const pcmBuffer = Buffer.from(pcmBase64, 'base64');
        
        // Build WAV header for PCM data
        const wavBuffer = Buffer.alloc(44 + pcmBuffer.length);
        wavBuffer.write("RIFF", 0);
        wavBuffer.writeUInt32LE(36 + pcmBuffer.length, 4);
        wavBuffer.write("WAVEfmt ", 8);
        wavBuffer.writeUInt32LE(16, 16);
        wavBuffer.writeUInt16LE(1, 20);
        wavBuffer.writeUInt16LE(1, 22);
        wavBuffer.writeUInt32LE(sampleRate, 24);
        wavBuffer.writeUInt32LE(sampleRate * 2, 28);
        wavBuffer.writeUInt16LE(2, 32);
        wavBuffer.writeUInt16LE(16, 34);
        wavBuffer.write("data", 36);
        wavBuffer.writeUInt32LE(pcmBuffer.length, 40);
        pcmBuffer.copy(wavBuffer, 44);

        // Build multipart/form-data payload
        const boundary = "Verity" + Math.random().toString(36).substring(2);
        const formParts = [
            `--${boundary}\r\nContent-Disposition: form-data; name="type"\r\n\r\ntts\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nVerity player ${name}\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="visibility"\r\n\r\nprivate\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="train_mode"\r\n\r\nfast\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="enhance_audio_quality"\r\n\r\ntrue\r\n`,
            `--${boundary}\r\nContent-Disposition: form-data; name="voices"; filename="speech.wav"\r\nContent-Type: audio/wav\r\n\r\n`
        ];

        const partHeaderBuffer = Buffer.from(formParts.join(''));
        const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`);
        const bodyBuffer = Buffer.concat([partHeaderBuffer, wavBuffer, footerBuffer]);

        const response = await fetch("https://api.fish.audio/model", {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${apiKey}`,
                "Content-Type": `multipart/form-data; boundary=${boundary}`
            },
            body: bodyBuffer
        });

        if (!response.ok) {
            throw new Error(`Fish Audio returned status ${response.status}`);
        }

        const data = await response.json();
        res.json({ success: true, modelId: data._id });
    } catch (err) {
        console.error("Model creation error:", err);
        res.status(500).json({ success: false, error: err.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Fish Speech & Models Proxy running on port ${PORT}`));

