import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';

export class MarketCache extends EventEmitter {
    constructor() {
        super();
        this.markets = new Map();
    }

    add(accountInfo) {
        const { pubkey, account } = accountInfo;
        if (!this.markets.has(pubkey.toBase58())) {
            this.markets.set(pubkey.toBase58(), {
                pubkey,
                account,
                timestamp: Date.now()
            });
            this.emit('market_added', { pubkey, account });
        }
    }

    get(pubkey) {
        return this.markets.get(typeof pubkey === 'string' ? pubkey : pubkey.toBase58());
    }

    remove(pubkey) {
        const key = typeof pubkey === 'string' ? pubkey : pubkey.toBase58();
        if (this.markets.has(key)) {
            const market = this.markets.get(key);
            this.markets.delete(key);
            this.emit('market_removed', market);
        }
    }

    clear() {
        this.markets.clear();
        this.emit('markets_cleared');
    }

    getAllMarkets() {
        return Array.from(this.markets.values());
    }
}
