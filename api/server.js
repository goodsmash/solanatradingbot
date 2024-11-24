import express from 'express';
import cors from 'cors';
import { TransactionCopierBot } from '../index.js';
import { Connection, PublicKey } from '@solana/web3.js';
import winston from 'winston';
import dotenv from 'dotenv';
import { limiter, websocketLimiter, tradingLimiter } from './middleware/rateLimiter.js';

dotenv.config();

const app = express();
const port = process.env.API_PORT || 3001;

// Configure logger
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'api-error.log', level: 'error' }),
        new winston.transports.File({ filename: 'api-combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Middleware
app.use(cors());
app.use(express.json());

// Apply rate limiting middleware
app.use(limiter); // Global rate limiter

// Store active bots
const activeBots = new Map();
const tokenCreationMonitors = new Map();
const largeTransactionMonitors = new Map();

// API Routes
app.post('/api/bot/start', tradingLimiter, async (req, res) => {
    try {
        const { targetWallet, settings } = req.body;
        
        if (activeBots.has(targetWallet)) {
            return res.status(400).json({ error: 'Bot already running for this wallet' });
        }

        const bot = new TransactionCopierBot({
            targetWallet,
            ...settings
        });

        await bot.initialize();
        activeBots.set(targetWallet, bot);
        
        res.json({ status: 'success', message: 'Bot started successfully' });
    } catch (error) {
        logger.error('Error starting bot:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/bot/stop', async (req, res) => {
    try {
        const { targetWallet } = req.body;
        const bot = activeBots.get(targetWallet);
        
        if (!bot) {
            return res.status(404).json({ error: 'Bot not found' });
        }

        await bot.cleanup();
        activeBots.delete(targetWallet);
        
        res.json({ status: 'success', message: 'Bot stopped successfully' });
    } catch (error) {
        logger.error('Error stopping bot:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/monitor/token-creation', async (req, res) => {
    try {
        const connection = new Connection(process.env.SOLANA_RPC_URL);
        const monitor = new TokenCreationMonitor(connection);
        
        await monitor.start();
        tokenCreationMonitors.set(monitor.id, monitor);
        
        res.json({ 
            status: 'success', 
            message: 'Token creation monitoring started',
            monitorId: monitor.id 
        });
    } catch (error) {
        logger.error('Error starting token creation monitor:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/monitor/large-transactions', async (req, res) => {
    try {
        const { threshold = 2000 } = req.body; // Default 2k USD
        const connection = new Connection(process.env.SOLANA_RPC_URL);
        const monitor = new LargeTransactionMonitor(connection, threshold);
        
        await monitor.start();
        largeTransactionMonitors.set(monitor.id, monitor);
        
        res.json({ 
            status: 'success', 
            message: 'Large transaction monitoring started',
            monitorId: monitor.id 
        });
    } catch (error) {
        logger.error('Error starting large transaction monitor:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/stats', (req, res) => {
    const stats = {
        activeBots: Array.from(activeBots.entries()).map(([wallet, bot]) => ({
            wallet,
            stats: bot.getStats()
        })),
        tokenCreationMonitors: tokenCreationMonitors.size,
        largeTransactionMonitors: largeTransactionMonitors.size
    };
    
    res.json(stats);
});

app.get('/api/wallets/profitable', async (req, res) => {
    try {
        const { timeframe = '24h', minProfit = 1000 } = req.query;
        const connection = new Connection(process.env.SOLANA_RPC_URL);
        const analyzer = new WalletAnalyzer(connection);
        
        const profitableWallets = await analyzer.findProfitableWallets(timeframe, minProfit);
        res.json(profitableWallets);
    } catch (error) {
        logger.error('Error finding profitable wallets:', error);
        res.status(500).json({ error: error.message });
    }
});

// WebSocket setup for real-time updates
import WebSocket from 'ws';
const wss = new WebSocket.Server({ noServer: true });

// Handle WebSocket upgrade with rate limiting
const server = app.listen(port, () => {
    logger.info(`API server running on port ${port}`);
});

server.on('upgrade', (request, socket, head) => {
    websocketLimiter(request, {}, (err) => {
        if (err) {
            socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
            socket.destroy();
            return;
        }
        
        wss.handleUpgrade(request, socket, head, (ws) => {
            wss.emit('connection', ws, request);
        });
    });
});

wss.on('connection', (ws, request) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Handle different subscription types
            switch(data.type) {
                case 'subscribe_token_creation':
                    subscribeToTokenCreation(ws);
                    break;
                case 'subscribe_large_transactions':
                    subscribeToLargeTransactions(ws);
                    break;
                case 'subscribe_bot_updates':
                    subscribeToBotUpdates(ws, data.wallet);
                    break;
            }
        } catch (error) {
            logger.error('Error handling WebSocket message:', error);
        }
    });
});

// Error handling middleware
app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
});

export default app;
