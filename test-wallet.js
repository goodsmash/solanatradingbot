import { config } from 'dotenv';
import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import path from 'path';

// Configure dotenv
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: path.join(__dirname, '.env') });

async function testWallet() {
    try {
        console.log('RPC URL:', process.env.SOLANA_RPC_URL);
        
        // Create connection
        const connection = new Connection(process.env.SOLANA_RPC_URL, 'confirmed');

        // Create wallet from private key
        const privateKey = bs58.decode(process.env.WALLET_PRIVATE_KEY);
        const wallet = Keypair.fromSecretKey(privateKey);

        console.log('Wallet Public Key:', wallet.publicKey.toString());

        // Get wallet balance
        const balance = await connection.getBalance(wallet.publicKey);
        console.log('Wallet Balance:', balance / 1e9, 'SOL');

        // Test connection
        const blockHeight = await connection.getBlockHeight();
        console.log('Current Block Height:', blockHeight);

        // Get recent performance samples
        const performance = await connection.getRecentPerformanceSamples(1);
        console.log('Network TPS:', performance[0].numTransactions / performance[0].samplePeriodSecs);

    } catch (error) {
        console.error('Error testing wallet:', error);
        console.error('Error details:', error.message);
        if (error.stack) {
            console.error('Stack trace:', error.stack);
        }
    }
}

testWallet();
