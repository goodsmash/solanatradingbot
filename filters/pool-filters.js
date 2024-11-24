import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { Mutex } from 'async-mutex';

export class PoolFilters {
    constructor(connection, config) {
        this.connection = connection;
        this.config = config;
        this.mutex = new Mutex();
    }

    async validatePool(poolInfo) {
        const release = await this.mutex.acquire();
        try {
            // Check pool size
            if (!await this.checkPoolSize(poolInfo)) {
                return false;
            }

            // Check if token is burnable
            if (this.config.checkBurned && !await this.checkBurned(poolInfo)) {
                return false;
            }

            // Check if token is freezable
            if (this.config.checkFreezable && !await this.checkFreezable(poolInfo)) {
                return false;
            }

            // Check if mint authority is renounced
            if (this.config.checkRenounced && !await this.checkRenounced(poolInfo)) {
                return false;
            }

            return true;
        } finally {
            release();
        }
    }

    async checkPoolSize(poolInfo) {
        try {
            const { baseToken, quoteToken } = poolInfo;
            const baseBalance = await this.connection.getTokenAccountBalance(baseToken);
            const quoteBalance = await this.connection.getTokenAccountBalance(quoteToken);

            const poolSize = parseFloat(quoteBalance.value.uiAmount);
            return poolSize >= this.config.minPoolSize && poolSize <= this.config.maxPoolSize;
        } catch (error) {
            console.error('Error checking pool size:', error);
            return false;
        }
    }

    async checkBurned(poolInfo) {
        try {
            const { mint } = poolInfo;
            const mintInfo = await this.connection.getAccountInfo(new PublicKey(mint));
            return mintInfo?.data[0] === 0; // Check if burn authority is disabled
        } catch (error) {
            console.error('Error checking burn status:', error);
            return false;
        }
    }

    async checkFreezable(poolInfo) {
        try {
            const { mint } = poolInfo;
            const mintInfo = await this.connection.getAccountInfo(new PublicKey(mint));
            return mintInfo?.data[1] === 0; // Check if freeze authority is disabled
        } catch (error) {
            console.error('Error checking freeze status:', error);
            return false;
        }
    }

    async checkRenounced(poolInfo) {
        try {
            const { mint } = poolInfo;
            const mintInfo = await this.connection.getAccountInfo(new PublicKey(mint));
            const mintAuthority = mintInfo?.data.slice(4, 36);
            return mintAuthority.every(byte => byte === 0); // Check if mint authority is disabled
        } catch (error) {
            console.error('Error checking mint authority:', error);
            return false;
        }
    }
}
