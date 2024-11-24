# Solana Transaction Copier Bot

This bot monitors a specific Solana wallet and copies its transactions using your Phantom wallet. It's designed to follow and replicate transactions with configurable parameters for safety and risk management.

## Features

- Real-time monitoring of target wallet transactions
- Transaction analysis and filtering
- Configurable transaction size limits
- Slippage protection
- Error handling and retry mechanisms

## Setup

1. Install dependencies:
```bash
npm install
```

2. Create your environment file:
```bash
cp .env.example .env
```

3. Configure your `.env` file with your settings:
- Add your RPC URL (recommended to use a reliable provider)
- Set your wallet private key (keep this secure!)
- Adjust the configuration parameters

## Usage

Start the bot:
```bash
npm start
```

## Security Considerations

- Never share your private key
- Start with small transaction amounts for testing
- Monitor the bot's activity regularly
- Use reliable RPC nodes
- Implement proper error handling

## Configuration

The bot can be configured through environment variables:

- `SOLANA_RPC_URL`: Your Solana RPC endpoint
- `WALLET_PRIVATE_KEY`: Your wallet's private key
- `MIN_BALANCE_TO_COPY`: Minimum balance required to copy a transaction
- `MAX_TRANSACTION_SIZE`: Maximum transaction size in SOL
- `SLIPPAGE_TOLERANCE`: Maximum allowed slippage percentage

## Disclaimer

This bot is for educational purposes only. Use at your own risk. Always:
- Test with small amounts first
- Understand the risks involved
- Monitor the bot's activity
- Implement proper security measures
