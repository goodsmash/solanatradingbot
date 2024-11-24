// Import required modules
import { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL, ComputeBudgetProgram } from '@solana/web3.js';
import express from 'express';
import fetch from 'node-fetch';
import { Decimal } from 'decimal.js';
import { config } from 'dotenv';
import bs58 from 'bs58';
import { WebSocketServer } from 'ws';

// Load environment variables
config();

// Constants with updated default values
const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const SCALING_FACTOR = parseFloat(process.env.SCALING_FACTOR) || 0.01;  
const MIN_BALANCE_TO_COPY = parseFloat(process.env.MIN_BALANCE_TO_COPY) || 0.005;  
const MAX_TRANSACTION_SIZE = parseFloat(process.env.MAX_TRANSACTION_SIZE) || 0.05;  
const SLIPPAGE_TOLERANCE = parseFloat(process.env.SLIPPAGE_TOLERANCE) || 0.005;  
const RPC_COOLDOWN = parseInt(process.env.RPC_COOLDOWN) || 2000; 
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES) || 10;
const COMPUTE_UNIT_LIMIT = parseInt(process.env.COMPUTE_UNIT_LIMIT) || 101337;
const COMPUTE_UNIT_PRICE = parseInt(process.env.COMPUTE_UNIT_PRICE) || 421197;

// Global variables
let botRunning = false;
let targetWallet = null;
let botWallet = null;
let solPrice = 0;
let lastRPCCall = 0;
let consecutiveErrors = 0;
const activeConnections = new Set();
const tradingStats = {
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    totalVolume: 0
};

// Initialize Express app
const app = express();
app.use(express.static('public'));

// Initialize server
const PORT = process.env.PORT || 3005;
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

// Initialize WebSocket server
const wss = new WebSocketServer({ server });

// Utility functions
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function broadcastMessage(message) {
    const messageStr = JSON.stringify(message);
    for (const client of activeConnections) {
        if (client.readyState === 1) { 
            client.send(messageStr);
        }
    }
}

function broadcastError(error) {
    broadcastMessage({
        type: 'error',
        data: error
    });
}

// Initialize Solana connection
const connection = new Connection(SOLANA_RPC_URL, 'confirmed');

// Enhanced RPC call with rate limiting and retries
async function makeRPCCall(func, ...args) {
    const now = Date.now();
    const timeSinceLastCall = now - lastRPCCall;
    
    if (timeSinceLastCall < RPC_COOLDOWN) {
        await sleep(RPC_COOLDOWN - timeSinceLastCall);
    }
    
    try {
        lastRPCCall = Date.now();
        const result = await func(...args);
        consecutiveErrors = 0;
        return result;
    } catch (error) {
        consecutiveErrors++;
        if (error.message.includes('429')) {
            const backoffTime = Math.min(1000 * Math.pow(2, consecutiveErrors), 30000);
            console.log(`RPC rate limit hit. Backing off for ${backoffTime}ms`);
            await sleep(backoffTime);
            if (consecutiveErrors <= MAX_RETRIES) {
                return makeRPCCall(func, ...args);
            }
        }
        throw error;
    }
}

// WebSocket connection handler
wss.on('connection', (ws) => {
    console.log('New client connected');
    activeConnections.add(ws);

    // Send initial state
    ws.send(JSON.stringify({
        type: 'config',
        data: {
            scalingFactor: SCALING_FACTOR,
            minBalance: MIN_BALANCE_TO_COPY,
            maxSize: MAX_TRANSACTION_SIZE,
            slippage: SLIPPAGE_TOLERANCE,
            computeUnitLimit: COMPUTE_UNIT_LIMIT,
            computeUnitPrice: COMPUTE_UNIT_PRICE,
            stats: tradingStats
        }
    }));

    // Initialize connection with current state
    ws.send(JSON.stringify({
        type: 'status',
        data: {
            status: botRunning ? 'running' : 'stopped',
            targetWallet,
            botWallet: botWallet ? botWallet.publicKey.toString() : null
        }
    }));

    // Handle incoming messages
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            
            switch (data.type) {
                case 'update_config':
                    // Update configuration
                    if (data.scalingFactor) process.env.SCALING_FACTOR = data.scalingFactor;
                    if (data.minBalance) process.env.MIN_BALANCE_TO_COPY = data.minBalance;
                    if (data.maxSize) process.env.MAX_TRANSACTION_SIZE = data.maxSize;
                    if (data.slippage) process.env.SLIPPAGE_TOLERANCE = data.slippage;
                    if (data.computeUnitLimit) process.env.COMPUTE_UNIT_LIMIT = data.computeUnitLimit;
                    if (data.computeUnitPrice) process.env.COMPUTE_UNIT_PRICE = data.computeUnitPrice;
                    break;
                    
                case 'start':
                    if (data.targetWallet) {
                        targetWallet = data.targetWallet;
                        await startBot();
                    }
                    break;
                    
                case 'stop':
                    stopBot();
                    break;
                    
                case 'wallet_connect':
                    try {
                        if (!botWallet) {
                            botWallet = Keypair.fromSecretKey(
                                bs58.decode(process.env.WALLET_PRIVATE_KEY)
                            );
                        }
                        
                        const balance = await connection.getBalance(botWallet.publicKey);
                        
                        broadcastMessage({
                            type: 'wallet',
                            data: {
                                address: botWallet.publicKey.toString(),
                                balance: balance / LAMPORTS_PER_SOL,
                                connected: true
                            }
                        });
                        
                        // Start monitoring SOL price
                        startSolPriceMonitoring();
                        
                    } catch (error) {
                        console.error('Error connecting wallet:', error);
                        broadcastError('Failed to connect wallet: ' + error.message);
                    }
                    break;
            }
        } catch (error) {
            console.error('Error processing message:', error);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected');
        activeConnections.delete(ws);
    });
});

// Start monitoring SOL price
async function startSolPriceMonitoring() {
    while (true) {
        try {
            const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd');
            const data = await response.json();
            solPrice = data.solana.usd;
            
            broadcastMessage({
                type: 'price',
                data: {
                    sol: solPrice
                }
            });
        } catch (error) {
            console.error('Error fetching SOL price:', error);
        }
        
        await sleep(60000); 
    }
}

// Enhanced transaction monitoring and trading
async function monitorTransactions() {
    if (!botRunning || !botWallet) return;
    
    console.log('Starting transaction monitoring and trading...');
    let lastSignature = null;

    while (botRunning) {
        try {
            // Get recent transactions with rate limiting
            const signatures = await makeRPCCall(
                connection.getSignaturesForAddress.bind(connection),
                new PublicKey(targetWallet),
                { limit: 10, before: lastSignature }  
            );

            for (const sigInfo of signatures) {
                try {
                    // Get transaction details with rate limiting
                    const tx = await makeRPCCall(
                        connection.getTransaction.bind(connection),
                        sigInfo.signature,
                        { maxSupportedTransactionVersion: 0 }
                    );

                    if (!tx || tx.meta?.err) continue;

                    // Process transaction
                    const txData = await analyzeTradingOpportunity(tx, sigInfo.signature);
                    
                    if (txData) {
                        // Update UI with transaction info
                        broadcastMessage({
                            type: 'transaction',
                            data: {
                                signature: txData.signature,
                                timestamp: txData.blockTime * 1000,
                                amount: txData.amount / LAMPORTS_PER_SOL,
                                fee: txData.fee / LAMPORTS_PER_SOL,
                                status: txData.status,
                                type: txData.type,
                                scaledAmount: (txData.amount / LAMPORTS_PER_SOL * SCALING_FACTOR).toFixed(4)
                            }
                        });

                        if (txData.shouldTrade) {
                            await executeTradeBasedOnTarget(txData);
                        }
                    }

                    if (!lastSignature) {
                        lastSignature = sigInfo.signature;
                    }
                } catch (txError) {
                    console.error('Error processing transaction:', txError);
                    broadcastError(`Transaction processing error: ${txError.message}`);
                }
            }

            // Rate limiting sleep
            await sleep(1000);

        } catch (error) {
            console.error('Error monitoring transactions:', error);
            broadcastError(`Monitoring error: ${error.message}`);
            await sleep(5000);
        }
    }
}

// Analyze trading opportunity
async function analyzeTradingOpportunity(tx, signature) {
    try {
        // Extract transaction details
        const preBalances = tx.meta.preBalances;
        const postBalances = tx.meta.postBalances;
        const accountKeys = tx.transaction.message.accountKeys;
        
        // Find the relevant token transfers
        const transfers = [];
        
        for (let i = 0; i < accountKeys.length; i++) {
            const balanceChange = (postBalances[i] - preBalances[i]) / LAMPORTS_PER_SOL;
            
            if (Math.abs(balanceChange) > MIN_BALANCE_TO_COPY) {
                transfers.push({
                    account: accountKeys[i].toString(),
                    change: balanceChange
                });
            }
        }
        
        if (transfers.length === 0) return null;
        
        // Analyze the transfer
        const largestTransfer = transfers.reduce((max, transfer) => 
            Math.abs(transfer.change) > Math.abs(max.change) ? transfer : max
        );
        
        // Check if this is a trade we should copy
        const shouldTrade = await validateTradeOpportunity(largestTransfer, tx);
        
        return {
            signature,
            blockTime: tx.blockTime,
            status: 'success',
            amount: Math.abs(largestTransfer.change * LAMPORTS_PER_SOL),
            fee: tx.meta.fee,
            type: shouldTrade ? 'TRADE' : 'INFO',
            shouldTrade,
            raw: tx,
            transfer: largestTransfer
        };
        
    } catch (error) {
        console.error('Error analyzing trade opportunity:', error);
        return null;
    }
}

// Validate if we should trade
async function validateTradeOpportunity(transfer, tx) {
    try {
        // Get bot's current balance
        const botBalance = await connection.getBalance(botWallet.publicKey);
        
        // Basic validations
        const amount = Math.abs(transfer.change);
        
        // Check if amount is within our limits
        if (amount < MIN_BALANCE_TO_COPY || amount > MAX_TRANSACTION_SIZE) {
            return false;
        }
        
        // Check if we have enough balance (including fees)
        const requiredBalance = (amount * SCALING_FACTOR * LAMPORTS_PER_SOL) + (tx.meta.fee * 2);
        if (botBalance < requiredBalance) {
            broadcastError(`Insufficient balance for trade. Required: ${requiredBalance / LAMPORTS_PER_SOL} SOL`);
            return false;
        }
        
        // Additional trading validations can be added here
        // - Check price impact
        // - Check slippage
        // - Check market conditions
        // - Check historical performance
        
        return true;
        
    } catch (error) {
        console.error('Error validating trade opportunity:', error);
        return false;
    }
}

// Enhanced transaction execution with compute budget
async function executeTradeBasedOnTarget(txData) {
    try {
        const { amount } = txData;
        const scaledAmount = new Decimal(amount).mul(SCALING_FACTOR).toNumber();
        
        // Create transaction
        const transaction = new Transaction();
        
        // Add compute budget instruction
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitPrice({
            microLamports: COMPUTE_UNIT_PRICE
        });
        const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
            units: COMPUTE_UNIT_LIMIT
        });
        transaction.add(computeBudgetIx, computeLimitIx);
        
        // Add transfer instruction
        transaction.add(
            SystemProgram.transfer({
                fromPubkey: botWallet.publicKey,
                toPubkey: new PublicKey(txData.transfer.account),
                lamports: scaledAmount
            })
        );

        // Sign and send transaction
        transaction.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
        transaction.feePayer = botWallet.publicKey;
        transaction.sign(botWallet);
        
        const signature = await makeRPCCall(
            connection.sendRawTransaction.bind(connection),
            transaction.serialize(),
            { skipPreflight: true, maxRetries: 3 }
        );

        // Update trading stats
        tradingStats.totalTrades++;
        tradingStats.successfulTrades++;
        tradingStats.totalVolume += scaledAmount / LAMPORTS_PER_SOL;

        broadcastMessage({
            type: 'trade_executed',
            data: {
                signature,
                amount: scaledAmount / LAMPORTS_PER_SOL,
                timestamp: Date.now(),
                stats: tradingStats
            }
        });

        return signature;
    } catch (error) {
        tradingStats.failedTrades++;
        broadcastError(`Trade execution error: ${error.message}`);
        throw error;
    }
}

// Start the bot
async function startBot() {
    if (botRunning) return;
    
    try {
        botRunning = true;
        broadcastMessage({
            type: 'status',
            data: {
                status: 'running',
                targetWallet,
                botWallet: botWallet ? botWallet.publicKey.toString() : null
            }
        });
        
        // Start transaction monitoring
        monitorTransactions();
        
    } catch (error) {
        console.error('Error starting bot:', error);
        broadcastError('Failed to start bot: ' + error.message);
        botRunning = false;
    }
}

// Stop the bot
function stopBot() {
    if (!botRunning) return;
    
    try {
        botRunning = false;
        broadcastMessage({
            type: 'status',
            data: {
                status: 'stopped',
                targetWallet,
                botWallet: botWallet ? botWallet.publicKey.toString() : null
            }
        });
        
    } catch (error) {
        console.error('Error stopping bot:', error);
        broadcastError('Failed to stop bot: ' + error.message);
    }
}

// Start the application
console.log('Starting Solana Transaction Bot...');
console.log('Listening on port:', PORT);
