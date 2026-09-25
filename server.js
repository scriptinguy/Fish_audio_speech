const express = require('express');
const { pack } = require('msgpackr');
const WebSocket = require('ws');

const app = express();
app.use(express.json({ limit: '50mb' }));

const FISH_API_KEY = process.env.FISH_API_KEY;

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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`TTS Proxy running on port ${PORT}`));

