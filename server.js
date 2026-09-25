const { pack } = require('msgpackr');
const WebSocket = require('ws');

// --- FISH SPEECH TTS ROUTE ---
app.post('/tts', async (req, res) => {
    try {
        const apiKey = req.headers.authorization?.replace('Bearer ', '') || process.env.FISH_API_KEY;
        if (!apiKey) {
            return res.status(401).json({ success: false, error: "Missing Fish Audio API Key." });
        }

        const { text, voiceId, sampleRate = 44100, model = "s2.1-pro-free" } = req.body;
        if (!text) {
            return res.status(400).json({ success: false, error: "Text is required for synthesis." });
        }

        // Connect to Fish Audio live WebSocket
        const ws = new WebSocket('wss://api.fish.audio/v1/tts/live', {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'model': model
            }
        });

        const audioChunks = [];

        ws.on('open', () => {
            // 1. Send start message
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

            // 2. Send text payload
            ws.send(pack({ event: 'text', text: text }));

            // 3. Flush and stop
            ws.send(pack({ event: 'flush' }));
            ws.send(pack({ event: 'stop' }));
        });

        ws.on('message', (data) => {
            // Fish Audio returns binary PCM audio chunks back over the WebSocket
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
