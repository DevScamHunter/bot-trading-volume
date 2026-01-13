import express from 'express';
import { WebSocketServer } from 'ws';
import { OstiumVolumeBot } from './bot.js';
import 'dotenv/config';

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static('public')); // front-end build

const server = app.listen(PORT, () => console.log(`Web dashboard running at http://localhost:${PORT}`));

// WebSocket
const wss = new WebSocketServer({ server });

wss.on('connection', (ws) => {
    console.log('Client connected');

    // gửi initial stats
    ws.send(JSON.stringify({ type: 'init', message: 'Connected to OSTIUM BOT' }));
});

// Khởi bot
const bot = new OstiumVolumeBot(
    {
        onUpdate: (data) => {
            // gửi dữ liệu realtime cho tất cả client
            const payload = JSON.stringify({ type: 'update', data });
            wss.clients.forEach(client => client.readyState === 1 && client.send(payload));
        }
    },
    false // true = dummy data, false = real bot
);

bot.start();
