import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import * as spl from '@solana/spl-token';
import Decimal from 'decimal.js';

export class WalletManager {
    constructor(connection, config) {
        this.connection = connection;
        this.config = config;
        this.walletBalance = new Decimal(0);
        this.minTradeSize = new Decimal(config.MIN_TRADE_SIZE || 0.001); // Minimum trade size in SOL
    }

    async connectWallet(privateKey) {
        try {
            // Convert private key to Uint8Array if it's a string
            const keyArray = typeof privateKey === 'string' 
                ? new Uint8Array(privateKey.split(',').map(num => parseInt(num)))
                : privateKey;

            this.wallet = Keypair.fromSecretKey(keyArray);
            console.log('Wallet connected:', this.wallet.publicKey.toString());
            
            // Initialize balance
            await this.updateBalance();
            
            return this.wallet;
        } catch (error) {
            console.error('Error connecting wallet:', error);
            throw error;
        }
    }

    async updateBalance() {
        try {
            const balance = await this.connection.getBalance(this.wallet.publicKey);
            this.walletBalance = new Decimal(balance).div(1e9); // Convert lamports to SOL
            return this.walletBalance;
        } catch (error) {
            console.error('Error updating balance:', error);
            throw error;
        }
    }

    calculateTradeSize(originalAmount) {
        const amount = new Decimal(originalAmount);
        
        // Calculate scaled amount based on our balance and scaling factor
        let scaledAmount = amount.mul(this.config.SCALING_FACTOR);
        
        // Ensure trade size is not below minimum
        if (scaledAmount.lt(this.minTradeSize)) {
            scaledAmount = this.minTradeSize;
        }
        
        // Ensure trade size doesn't exceed maximum percentage of our balance
        const maxTradeSize = this.walletBalance.mul(this.config.MAX_BALANCE_PERCENTAGE);
        if (scaledAmount.gt(maxTradeSize)) {
            scaledAmount = maxTradeSize;
        }
        
        return scaledAmount;
    }

    async checkTradeViability(tradeAmount) {
        await this.updateBalance();
        
        // Convert trade amount to Decimal
        const amount = new Decimal(tradeAmount);
        
        // Check if we have enough balance (including some buffer for fees)
        const requiredBalance = amount.mul(1.01); // Add 1% buffer for fees
        return this.walletBalance.gte(requiredBalance);
    }

    getPublicKey() {
        return this.wallet?.publicKey;
    }
}
