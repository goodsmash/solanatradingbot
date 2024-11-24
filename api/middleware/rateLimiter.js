import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

// Create Redis client with retry strategy
const redisClient = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: {
        reconnectStrategy: (retries) => {
            if (retries > 20) {
                console.error('Redis connection failed after 20 retries');
                return new Error('Redis connection failed');
            }
            return Math.min(retries * 100, 3000);
        }
    }
});

redisClient.on('error', (err) => console.error('Redis Client Error:', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));
redisClient.on('ready', () => console.log('Redis Client Ready'));
redisClient.on('reconnecting', () => console.log('Redis Client Reconnecting'));

// Connect to Redis
try {
    await redisClient.connect();
} catch (err) {
    console.error('Redis connection error:', err);
    // Continue without Redis - will use memory store as fallback
}

// Configure rate limiter with fallback to memory store if Redis fails
const createLimiter = (options) => {
    const baseConfig = {
        windowMs: options.windowMs,
        max: options.max,
        standardHeaders: true,
        legacyHeaders: false,
        message: options.message,
    };

    try {
        if (redisClient.isReady) {
            return rateLimit({
                ...baseConfig,
                store: new RedisStore({
                    sendCommand: (...args) => redisClient.sendCommand(args),
                    prefix: options.prefix,
                }),
            });
        }
    } catch (err) {
        console.warn('Using memory store fallback for rate limiting:', err.message);
    }

    return rateLimit(baseConfig);
};

// Global API rate limiter
export const limiter = createLimiter({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
    prefix: 'rl:solana:',
    message: {
        status: 'error',
        message: 'Too many requests, please try again later.'
    }
});

// WebSocket connections limiter
export const websocketLimiter = createLimiter({
    windowMs: 60 * 1000,
    max: 60,
    prefix: 'rl:ws:',
    message: {
        status: 'error',
        message: 'Too many WebSocket connections, please try again later.'
    }
});

// Trading operations limiter
export const tradingLimiter = createLimiter({
    windowMs: 5 * 60 * 1000,
    max: 20,
    prefix: 'rl:trade:',
    message: {
        status: 'error',
        message: 'Trading rate limit exceeded, please try again later.'
    }
});
