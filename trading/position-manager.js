import { EventEmitter } from 'events';
import Decimal from 'decimal.js';

export class PositionManager extends EventEmitter {
    constructor(connection, config) {
        super();
        this.connection = connection;
        this.config = config;
        this.positions = new Map();
    }

    async openPosition(tokenMint, amount, entryPrice) {
        const position = {
            tokenMint,
            amount: new Decimal(amount),
            entryPrice: new Decimal(entryPrice),
            timestamp: Date.now(),
            pnl: new Decimal(0),
            status: 'open'
        };

        this.positions.set(tokenMint.toBase58(), position);
        this.emit('position_updated', position);
        
        // Start monitoring position
        this.monitorPosition(tokenMint);
    }

    async closePosition(tokenMint, exitPrice, reason = 'manual') {
        const position = this.positions.get(tokenMint.toBase58());
        if (!position) return null;

        position.status = 'closed';
        position.exitPrice = new Decimal(exitPrice);
        position.closeTimestamp = Date.now();
        position.pnl = this.calculatePnL(position);
        position.closeReason = reason;

        this.positions.delete(tokenMint.toBase58());
        this.emit('position_updated', position);

        return position;
    }

    calculatePnL(position) {
        const { amount, entryPrice, exitPrice } = position;
        return amount.mul(exitPrice.minus(entryPrice)).div(entryPrice);
    }

    async monitorPosition(tokenMint) {
        const position = this.positions.get(tokenMint.toBase58());
        if (!position) return;

        const checkInterval = setInterval(async () => {
            try {
                // Simulate price update for testing
                const currentPrice = new Decimal(Math.random() * 100);
                
                // Update position PnL
                position.currentPrice = currentPrice;
                position.pnl = this.calculatePnL({
                    ...position,
                    exitPrice: currentPrice
                });

                // Check take profit and stop loss
                const priceChange = currentPrice.minus(position.entryPrice)
                    .div(position.entryPrice);

                if (priceChange.gte(this.config.takeProfit)) {
                    await this.closePosition(tokenMint, currentPrice, 'take_profit');
                    clearInterval(checkInterval);
                } else if (priceChange.lte(-this.config.stopLoss)) {
                    await this.closePosition(tokenMint, currentPrice, 'stop_loss');
                    clearInterval(checkInterval);
                } else {
                    this.emit('position_updated', position);
                }
            } catch (error) {
                console.error('Error monitoring position:', error);
            }
        }, this.config.priceCheckInterval || 2000);
    }

    getPosition(tokenMint) {
        return this.positions.get(tokenMint.toBase58());
    }

    getAllPositions() {
        return Array.from(this.positions.values());
    }

    getOpenPositionsCount() {
        return this.positions.size;
    }

    getTotalPnL() {
        return Array.from(this.positions.values())
            .reduce((total, pos) => total.plus(pos.pnl), new Decimal(0));
    }
}
