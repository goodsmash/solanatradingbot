import express from 'express';
import { WebSocketServer } from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import { TradeManager } from './trading/trade-manager.js';
import { PositionManager } from './trading/position-manager.js';
import { MarketMaker } from './trading/market-maker.js';
import { WalletManager } from './wallet/wallet-manager.js';
import { TransactionExecutor } from './transactions/transaction-executor.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

// Initialize environment variables
dotenv.config();

// ES Module __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Express app
const app = express();
const port = process.env.PORT || 3000;

// Create Solana connection
const connection = new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com',
    'confirmed'
);

// Initialize configuration
const config = {
    scalingFactor: parseFloat(process.env.SCALING_FACTOR) || 0.01,
    minBalanceToCopy: parseFloat(process.env.MIN_BALANCE_TO_COPY) || 0.005,
    maxTransactionSize: parseFloat(process.env.MAX_TRANSACTION_SIZE) || 0.05,
    slippageTolerance: parseFloat(process.env.SLIPPAGE_TOLERANCE) || 0.005,
    takeProfit: parseFloat(process.env.TAKE_PROFIT) || 0.4,
    stopLoss: parseFloat(process.env.STOP_LOSS) || 0.2,
    priceCheckInterval: parseInt(process.env.PRICE_CHECK_INTERVAL) || 2000,
    computeUnitLimit: parseInt(process.env.COMPUTE_UNIT_LIMIT) || 101337,
    computeUnitPrice: parseInt(process.env.COMPUTE_UNIT_PRICE) || 421197,
    maxRetries: parseInt(process.env.MAX_RETRIES) || 10,
    rpcCooldown: parseInt(process.env.RPC_COOLDOWN) || 2000,
    programId: new PublicKey(process.env.RAYDIUM_PROGRAM_ID || '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8')
};

// Initialize managers
let walletManager;
let transactionExecutor;
let tradeManager;
let positionManager;
let marketMaker;
let targetWallet;

async function initializeBot() {
    try {
        console.log('Initializing bot components...');
        
        // Initialize wallet manager
        walletManager = new WalletManager(connection, config);
        await walletManager.connectWallet(process.env.WALLET_PRIVATE_KEY);
        console.log('Wallet connected:', walletManager.getPublicKey().toString());
        
        // Initialize transaction executor
        transactionExecutor = new TransactionExecutor(connection, config);
        
        // Initialize trade manager with wallet
        tradeManager = new TradeManager(connection, walletManager.getPublicKey(), config, walletManager, transactionExecutor);
        await tradeManager.initialize();
        
        // Initialize position manager
        positionManager = new PositionManager(connection, config);
        
        // Initialize market maker
        marketMaker = new MarketMaker(connection, config);
        
        console.log('Bot components initialized successfully');
        return true;
    } catch (error) {
        console.error('Error initializing bot:', error);
        return false;
    }
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Create HTTP server
const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
}).on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
        console.error(`Port ${port} is already in use. Please try a different port.`);
    } else {
        console.error('Server error:', error);
    }
    process.exit(1);
});

// Create WebSocket server
const wss = new WebSocketServer({ server });

// WebSocket connection handler
wss.on('connection', async (ws) => {
    console.log('Client connected');
    
    // Initialize bot components if not already initialized
    if (!tradeManager) {
        const success = await initializeBot();
        if (!success) {
            ws.send(JSON.stringify({ type: 'error', message: 'Failed to initialize bot components' }));
            return;
        }
    }
    
    // Send initial wallet status
    ws.send(JSON.stringify({
        type: 'wallet_status',
        connected: true,
        address: walletManager.getPublicKey().toString(),
        balance: (await walletManager.updateBalance()).toString()
    }));

    // Send initial status
    ws.send(JSON.stringify({
        type: 'status',
        data: {
            botWallet: walletManager.getPublicKey().toString(),
            targetWallet: targetWallet?.toBase58() || null,
            status: 'stopped'
        }
    }));

    // Handle incoming messages
    ws.handleMessage = async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'start':
                    if (!data.targetWallet) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Target wallet not specified'
                        }));
                        return;
                    }
                    
                    try {
                        targetWallet = new PublicKey(data.targetWallet);
                    } catch (error) {
                        ws.send(JSON.stringify({
                            type: 'error',
                            message: 'Invalid target wallet address'
                        }));
                        return;
                    }
                    
                    // Start monitoring
                    await startMonitoring(ws);
                    break;

                case 'stop':
                    await stopMonitoring();
                    break;

                case 'update_config':
                    Object.assign(config, data.config);
                    ws.send(JSON.stringify({
                        type: 'status',
                        data: { status: 'config_updated' }
                    }));
                    break;

                default:
                    ws.send(JSON.stringify({
                        type: 'error',
                        message: 'Unknown message type: ' + data.type
                    }));
            }
        } catch (error) {
            console.error('Message handling error:', error);
            ws.send(JSON.stringify({
                type: 'error',
                message: error.message
            }));
        }
    };

    ws.on('message', (message) => ws.handleMessage(message));
    
    ws.on('close', () => {
        console.log('Client disconnected');
    });

    ws.on('error', (error) => {
        console.error('WebSocket error:', error);
    });
});

// Start monitoring function
async function startMonitoring(ws) {
    try {
        if (!walletManager) {
            throw new Error('Wallet manager not initialized');
        }

        // Set up event handlers
        tradeManager.on('trade_executed', (trade) => {
            ws.send(JSON.stringify({
                type: 'trade_executed',
                data: trade
            }));
        });

        positionManager.on('position_updated', (position) => {
            ws.send(JSON.stringify({
                type: 'position_update',
                data: position
            }));
        });

        // Start monitoring target wallet
        await tradeManager.startMonitoring(targetWallet);

        ws.send(JSON.stringify({
            type: 'status',
            data: {
                status: 'running',
                targetWallet: targetWallet.toBase58()
            }
        }));
    } catch (error) {
        console.error('Error starting monitoring:', error);
        ws.send(JSON.stringify({
            type: 'error',
            message: error.message
        }));
    }
}

// Stop monitoring function
async function stopMonitoring() {
    try {
        if (tradeManager) {
            await tradeManager.stopMonitoring();
        }
        
        wss.clients.forEach(client => {
            client.send(JSON.stringify({
                type: 'status',
                data: {
                    status: 'stopped'
                }
            }));
        });
    } catch (error) {
        console.error('Error stopping monitoring:', error);
        wss.clients.forEach(client => {
            client.send(JSON.stringify({
                type: 'error',
                message: error.message
            }));
        });
    }
}

// Handle process termination
process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await stopMonitoring();
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
    console.error('Uncaught exception:', error);
    stopMonitoring().finally(() => {
        server.close(() => {
            console.log('Server closed due to error');
            process.exit(1);
        });
    });
});
