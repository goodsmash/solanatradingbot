import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';
import { TransactionCopierBot } from './index.js';
import express from 'express';
import winston from 'winston';
import net from 'net';

// Configure dotenv
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: path.join(__dirname, '.env') });

// Configure logging
const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.File({ filename: 'error.log', level: 'error' }),
        new winston.transports.File({ filename: 'combined.log' }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Function to find an available port
async function findAvailablePort(startPort) {
    const isPortAvailable = (port) => {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.once('error', () => resolve(false));
            server.once('listening', () => {
                server.close(() => resolve(true));
            });
            server.listen(port);
        });
    };

    let port = startPort;
    while (!(await isPortAvailable(port))) {
        port++;
    }
    return port;
}

// Error handling
process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection:', reason);
});

// Start bot
async function startBot() {
    try {
        logger.info('Starting Transaction Copier Bot...');
        logger.info('Target Wallet:', process.env.TARGET_WALLET);
        logger.info('Bot Wallet:', '44ZwdfBm5tT54XkNzBjLFgP3fmTQYWTqv6Cr87YZD5Rh');
        
        // Initialize Express app
        const app = express();
        const port = await findAvailablePort(3000);

        // Initialize bot
        const bot = new TransactionCopierBot();
        await bot.initialize();

        // Start monitoring
        await bot.startMonitoring();

        // Start Express server
        app.listen(port, () => {
            logger.info(`Bot server running on port ${port}`);
        });

        // Handle process termination
        process.on('SIGINT', async () => {
            logger.info('Shutting down bot...');
            await bot.cleanup();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            logger.info('Shutting down bot...');
            await bot.cleanup();
            process.exit(0);
        });

        // Handle uncaught exceptions
        process.on('uncaughtException', async (error) => {
            logger.error('Uncaught Exception:', error);
            await bot.cleanup();
            process.exit(1);
        });

        // Handle unhandled promise rejections
        process.on('unhandledRejection', async (reason, promise) => {
            logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
            await bot.cleanup();
            process.exit(1);
        });

        logger.info('Bot successfully initialized and running...');
        
        // Keep process running
        process.stdin.resume();
        
    } catch (error) {
        logger.error('Error starting bot:', error);
        process.exit(1);
    }
}

startBot();
