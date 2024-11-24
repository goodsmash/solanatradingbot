import { PublicKey } from '@solana/web3.js';
import { BN } from 'bn.js';
import { Decimal } from 'decimal.js';

export class TransactionParser {
    constructor(connection) {
        this.connection = connection;
    }

    async parseTransaction(signature) {
        try {
            const tx = await this.connection.getTransaction(signature, {
                commitment: 'confirmed',
                maxSupportedTransactionVersion: 0
            });

            if (!tx) {
                console.log('Transaction not found:', signature);
                return null;
            }

            return this.extractTransactionDetails(tx);
        } catch (error) {
            console.error('Error parsing transaction:', error);
            return null;
        }
    }

    extractTransactionDetails(tx) {
        try {
            // Extract basic transaction info
            const details = {
                signature: tx.transaction.signatures[0],
                timestamp: tx.blockTime ? new Date(tx.blockTime * 1000) : new Date(),
                success: tx.meta?.err === null,
                tokenTransfers: [],
                solTransfers: []
            };

            // Parse token transfers
            if (tx.meta?.postTokenBalances && tx.meta?.preTokenBalances) {
                this.parseTokenTransfers(tx, details);
            }

            // Parse SOL transfers
            if (tx.meta?.innerInstructions) {
                this.parseSolTransfers(tx, details);
            }

            return this.normalizeTransactionDetails(details);
        } catch (error) {
            console.error('Error extracting transaction details:', error);
            return null;
        }
    }

    parseTokenTransfers(tx, details) {
        const preBalances = new Map(
            tx.meta.preTokenBalances.map(b => [b.accountIndex, b])
        );
        const postBalances = new Map(
            tx.meta.postTokenBalances.map(b => [b.accountIndex, b])
        );

        for (const [accountIndex, postBalance] of postBalances) {
            const preBalance = preBalances.get(accountIndex);
            if (!preBalance) continue;

            const amountChange = new Decimal(postBalance.uiTokenAmount.uiAmount)
                .minus(new Decimal(preBalance.uiTokenAmount.uiAmount));

            if (!amountChange.isZero()) {
                details.tokenTransfers.push({
                    mint: new PublicKey(postBalance.mint),
                    amount: amountChange.abs().toString(),
                    direction: amountChange.isPositive() ? 'in' : 'out',
                    decimals: postBalance.uiTokenAmount.decimals
                });
            }
        }
    }

    parseSolTransfers(tx, details) {
        const accountKeys = tx.transaction.message.accountKeys;
        
        for (const ix of tx.meta.innerInstructions) {
            for (const innerIx of ix.instructions) {
                if (innerIx.program === 'system' && innerIx.parsed?.type === 'transfer') {
                    const amount = new Decimal(innerIx.parsed.info.lamports)
                        .div(new Decimal(1e9))
                        .toString();

                    details.solTransfers.push({
                        from: new PublicKey(innerIx.parsed.info.source),
                        to: new PublicKey(innerIx.parsed.info.destination),
                        amount
                    });
                }
            }
        }
    }

    normalizeTransactionDetails(details) {
        // Combine token and SOL transfers into a standardized format
        const normalized = {
            signature: details.signature,
            timestamp: details.timestamp,
            success: details.success,
            transfers: []
        };

        // Add token transfers
        for (const transfer of details.tokenTransfers) {
            normalized.transfers.push({
                type: 'token',
                mint: transfer.mint.toString(),
                amount: transfer.amount,
                direction: transfer.direction,
                decimals: transfer.decimals
            });
        }

        // Add SOL transfers
        for (const transfer of details.solTransfers) {
            normalized.transfers.push({
                type: 'sol',
                from: transfer.from.toString(),
                to: transfer.to.toString(),
                amount: transfer.amount
            });
        }

        return normalized;
    }

    isSwapTransaction(details) {
        if (!details?.transfers || details.transfers.length < 2) return false;

        // Check for token swap pattern (one token out, another token in)
        const tokenTransfers = details.transfers.filter(t => t.type === 'token');
        const hasTokenIn = tokenTransfers.some(t => t.direction === 'in');
        const hasTokenOut = tokenTransfers.some(t => t.direction === 'out');

        return hasTokenIn && hasTokenOut;
    }

    getSwapDetails(details) {
        if (!this.isSwapTransaction(details)) return null;

        const tokenIn = details.transfers.find(t => t.direction === 'out');
        const tokenOut = details.transfers.find(t => t.direction === 'in');

        return {
            tokenIn: {
                mint: tokenIn.mint,
                amount: tokenIn.amount,
                decimals: tokenIn.decimals
            },
            tokenOut: {
                mint: tokenOut.mint,
                amount: tokenOut.amount,
                decimals: tokenOut.decimals
            },
            timestamp: details.timestamp
        };
    }
}
