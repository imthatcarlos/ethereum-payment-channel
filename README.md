# Ethereum Payment Channel
Ethereum payment channels allow for off-chain transactions with an on-chain settlement. Parties open one channel with a deposit, continue to sign and verify transactions off-chain, and close the channel with one final transaction, on-chain.

### Setup
Clone the repo and run `npm install`. You will need truffle installed globally

### Compile & migrate
```
truffle compile
truffle migrate
```

### Run tests
Make sure you have testrpc running and listening on port 8545
```
truffle test
```
