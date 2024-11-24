import { Transaction, ComputeBudgetProgram, sendAndConfirmTransaction } from '@solana/web3.js';
import { Mutex } from 'async-mutex';

export class TransactionExecutor {
    constructor(connection, config) {
        this.connection = connection;
        this.config = config;
        this.mutex = new Mutex();
    }

    async execute(instructions, signers, opts = {}) {
        const release = await this.mutex.acquire();
        try {
            // Create transaction
            const transaction = new Transaction();

            // Add compute budget instructions
            const computeBudgetIx = ComputeBudgetProgram.setComputeUnitPrice({
                microLamports: this.config.computeUnitPrice
            });
            const computeLimitIx = ComputeBudgetProgram.setComputeUnitLimit({
                units: this.config.computeUnitLimit
            });
            transaction.add(computeBudgetIx, computeLimitIx);

            // Add provided instructions
            transaction.add(...instructions);

            // Get latest blockhash
            const { blockhash } = await this.connection.getLatestBlockhash(this.connection.commitment);
            transaction.recentBlockhash = blockhash;
            transaction.feePayer = signers[0].publicKey;

            // Sign transaction
            transaction.sign(...signers);

            // Send and confirm transaction
            const signature = await sendAndConfirmTransaction(
                this.connection,
                transaction,
                signers,
                {
                    skipPreflight: opts.skipPreflight || true,
                    maxRetries: opts.maxRetries || this.config.maxRetries,
                    commitment: opts.commitment || this.connection.commitment
                }
            );

            return {
                signature,
                success: true
            };
        } catch (error) {
            console.error('Transaction execution error:', error);
            return {
                signature: null,
                success: false,
                error: error.message
            };
        } finally {
            release();
        }
    }

    async executeRaw(rawTransaction, opts = {}) {
        const release = await this.mutex.acquire();
        try {
            const signature = await this.connection.sendRawTransaction(
                rawTransaction,
                {
                    skipPreflight: opts.skipPreflight || true,
                    maxRetries: opts.maxRetries || this.config.maxRetries
                }
            );

            if (opts.confirm) {
                await this.connection.confirmTransaction(signature);
            }

            return {
                signature,
                success: true
            };
        } catch (error) {
            console.error('Raw transaction execution error:', error);
            return {
                signature: null,
                success: false,
                error: error.message
            };
        } finally {
            release();
        }
    }
}
