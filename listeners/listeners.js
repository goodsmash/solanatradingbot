import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';

export class Listeners extends EventEmitter {
    constructor(connection) {
        super();
        this.connection = connection;
        this.subscriptions = [];
    }

    async start(config) {
        // Subscribe to target wallet transactions
        const targetWalletSub = await this.subscribeToWalletTransactions(config.targetWallet);
        this.subscriptions.push(targetWalletSub);

        // Subscribe to bot wallet changes
        if (config.botWallet) {
            const botWalletSub = await this.subscribeToWalletChanges(config.botWallet);
            this.subscriptions.push(botWalletSub);
        }

        // Subscribe to price updates if enabled
        if (config.trackPrices) {
            const priceSub = await this.subscribeToPriceUpdates();
            this.subscriptions.push(priceSub);
        }
    }

    async stop() {
        for (const sub of this.subscriptions) {
            try {
                await this.connection.removeAccountChangeListener(sub);
            } catch (error) {
                console.error('Error removing listener:', error);
            }
        }
        this.subscriptions = [];
    }

    async subscribeToWalletTransactions(walletAddress) {
        const pubkey = new PublicKey(walletAddress);
        return this.connection.onAccountChange(
            pubkey,
            (accountInfo) => {
                this.emit('wallet_transaction', {
                    pubkey,
                    account: accountInfo,
                    timestamp: Date.now()
                });
            },
            'confirmed'
        );
    }

    async subscribeToWalletChanges(walletAddress) {
        const pubkey = new PublicKey(walletAddress);
        return this.connection.onProgramAccountChange(
            TOKEN_PROGRAM_ID,
            (accountInfo) => {
                this.emit('wallet_change', {
                    pubkey: accountInfo.accountId,
                    account: accountInfo.accountInfo,
                    timestamp: Date.now()
                });
            },
            'confirmed',
            [
                {
                    memcmp: {
                        offset: 32,
                        bytes: pubkey.toBase58()
                    }
                }
            ]
        );
    }

    async subscribeToPriceUpdates() {
        // Implement price feed subscription
        // This could be through Pyth, Chainlink, or other oracle
        return null;
    }
}
