const util = require('ethereumjs-util');

const TokenChannels = artifacts.require('./TokenChannels.sol');
const MyToken = artifacts.require('./MyToken.sol');

const assertRevert = require('../node_modules/zeppelin-solidity/test/helpers/assertRevert');
const expectEvent = require('../node_modules/zeppelin-solidity/test/helpers/expectEvent');

/**
 * Create instance of MyToken and mint some for the account given
 */
async function mintToken (account) {
  var token = await MyToken.new('MyToken', 'MYT', 10, {from: account});
  await token.mint(account, web3.toWei('100', 'ether'));
  await token.finishMinting();
  return token;
}

/**
 * Open a valid channel between sender and recipient w value = 5 ether
 */
async function openValidChannel(ledger, token, sender, recipient, challenge = 0) {
  var deposit = web3.toWei('5', 'ether');

  // need to approve the transfer from sender to contract
  token.approve(ledger.address, deposit, {from: sender});

  await ledger.openChannel(
    token.address,
    recipient,
    deposit,
    challenge,
    {value: deposit, from: sender}
  );
}

/**
 * Increases testrpc time by the passed duration in seconds
 * source: zeppelin-solidity/test/helpers/
 * NOTE: evm_increaseTime might cause issues
 * issue: https://github.com/trufflesuite/ganache-cli/issues/390
 */
async function increaseTime (duration) {
  const id = Date.now();

  return new Promise((resolve, reject) => {
    web3.currentProvider.sendAsync({
      jsonrpc: '2.0',
      method: 'evm_increaseTime',
      params: [duration],
      id: id,
    }, err1 => {
      if (err1) return reject(err1);

      web3.currentProvider.sendAsync({
        jsonrpc: '2.0',
        method: 'evm_mine',
        id: id + 1,
      }, (err2, res) => {
        return err2 ? reject(err2) : resolve(res);
      });
    });
  });
}

contract('TokenChannels', function(accounts) {
  describe('openChannel', function() {
    it('opens a channel between accounts[0] and accounts[1]', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);

      await openValidChannel(ledger, token, accounts[0], accounts[1]);

      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);
      assert.notEqual(web3.toDecimal(channelId), 0, 'channel has a valid id');
    });

    it('should not allows opening a channel between the same person', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);

      var deposit = web3.toWei('5', 'ether');
      token.approve(ledger.address, deposit, {from: accounts[0]});

      try {
        await ledger.openChannel(
          token.address,
          accounts[0],
          deposit,
          0,
          {value: deposit, from: accounts[0]}
        );
      } catch(error) {
        assertRevert(error);
      }
    });

    it('should not allow opening a channel without tx value matching deposit', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);

      var deposit = web3.toWei('5', 'ether');
      token.approve(ledger.address, deposit, {from: accounts[0]});

      try {
        await ledger.openChannel(
          token.address,
          accounts[0],
          deposit,
          0,
          {value: 0, from: accounts[0]}
        );
      } catch(error) {
        assertRevert(error);
      }
    });

    it('should not allow opening a channel unless sender has appproved moving funds', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);

      var deposit = web3.toWei('5', 'ether');
      // token.approve(ledger.address, deposit, {from: accounts[0]});

      try {
        await ledger.openChannel(
          token.address,
          accounts[0],
          deposit,
          0,
          {value: 0, from: accounts[0]}
        );
      } catch(error) {
        assertRevert(error);
      }
    });

  });

  describe('verifyMsg', function() {
    it('correctly verifies a valid messsage', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);
      await openValidChannel(ledger, token, accounts[0], accounts[1]);
      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);

      // Bob wants to send Alice 1 ether
      var newValue = web3.toWei('1', 'ether');
      var messageHash = web3.sha3(channelId, newValue);
      var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      var isValid = await ledger.verifyMsg([channelId, messageHash, r, s], v, newValue, {from: accounts[0]})
      assert.equal(isValid, true, 'the sender\'s public address matches');
    });

    it('correctly verifies an invalid messsage', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);
      await openValidChannel(ledger, token, accounts[0], accounts[1]);
      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);

      // Someone else signs a message on Bob's behalf
      var newValue = web3.toWei('1', 'ether');
      var messageHash = web3.sha3(channelId, newValue);
      var sig = web3.eth.sign(accounts[3], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      var isValid = await ledger.verifyMsg([channelId, messageHash, r, s], v, newValue, {from: accounts[0]});
      assert.equal(isValid, false, 'the sender\'s public address does not match');
    });

  });

  describe('closeChannel', function() {
    it('allows the recipient to close the channel', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);
      await openValidChannel(ledger, token, accounts[0], accounts[1]);

      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);

      // Bob sends Alice 1 Ether, signs the transaction
      var finalValue = web3.toWei('1', 'ether');
      var messageHash = web3.sha3(channelId, finalValue);
      var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      // Alice submits the final transaction to the channel and closes it
      await ledger.closeChannel([channelId, messageHash, r, s], v, finalValue, 1, {from: accounts[1]});
      var status = await ledger.getChannelStatus(channelId);

      assert.equal(status.toNumber(), 2, 'the channel\'s state is ChannelState.Closed');
    });

    it('should not allow access to an already closed channel', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);
      await openValidChannel(ledger, token, accounts[0], accounts[1]);

      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);

      // Bob sends Alice 1 Ether, signs the transaction
      var finalValue = web3.toWei('1', 'ether');
      var messageHash = web3.sha3(channelId, finalValue);
      var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      // Alice submits the final transaction to the channel and closes it
      await ledger.closeChannel([channelId, messageHash, r, s], v, finalValue, 1, {from: accounts[1]});

      try {
        // Alice tries closing the channel again
        await ledger.closeChannel([channelId, messageHash, r, s], v, finalValue, 1, {from: accounts[3]});
      } catch(error) {
        assertRevert(error);
      }
    });

    it('should not allow anyone but the recipient to close the channel', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);
      await openValidChannel(ledger, token, accounts[0], accounts[1]);

      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);

      // Bob sends Alice 1 Ether, signs the transaction
      var finalValue = web3.toWei('1', 'ether');
      var messageHash = web3.sha3(channelId, finalValue);
      var sig = web3.eth.sign(accounts[3], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      try {
        // Alice's neighbor Cindy submits the final transaction to the channel
        await ledger.closeChannel([channelId, messageHash, r, s], v, finalValue, 1, {from: accounts[3]});
      } catch(error) {
        assertRevert(error);
      }
    });

    it('pays the recipient and refunds the remaining of the deposit to the sender', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);

      // let's get Bob's and Alice's balances of MyToken before opening a channel
      var senderBalanceBefore = await token.balanceOf(accounts[0]);
      var recipientBalanceBefore = await token.balanceOf(accounts[1]);

      await openValidChannel(ledger, token, accounts[0], accounts[1]);

      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);

      // Bob signs the transaction to send 1 Ether to Alice
      var finalValue = web3.toWei('1', 'ether');
      var messageHash = web3.sha3(channelId, finalValue);
      var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      // Alice submits the final transaction to the channel and closes it
      await ledger.closeChannel([channelId, messageHash, r, s], v, finalValue, 1, {from: accounts[1]});

      var senderBalance = await token.balanceOf(accounts[0]);
      var recipientBalance = await token.balanceOf(accounts[1]);

      assert.equal(senderBalanceBefore.toNumber() - finalValue,
        senderBalance.toNumber(), 'Bob 1 Ether less than before');
      assert.equal(recipientBalanceBefore.toNumber() + finalValue,
        recipientBalance.toNumber(), 'Alice was paid 1 Ether');
    });

    it('keeps the channel open when challenge data is set', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);

      var oneDayPeriod = 1 * 24 * 60 * 60;
      await openValidChannel(ledger, token, accounts[0], accounts[1], oneDayPeriod);

      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);

      // Bob signs the transaction to send 1 Ether to Alice
      var finalValue = web3.toWei('1', 'ether');
      var messageHash = web3.sha3(channelId, finalValue);
      var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      // Alice submits the final transaction to the channel and closes it
      await ledger.closeChannel([channelId, messageHash, r, s], v, finalValue, 1, {from: accounts[1]});

      var status = await ledger.getChannelStatus(channelId);
      assert.equal(status.toNumber(), 1, 'the channel\'s state is ChannelState.Closing');

      // simulate half the day passing
      await increaseTime(oneDayPeriod / 2);

      var remainingPeriod = await ledger.getChannelRemainingChallengePeriod(channelId);
      assert.equal(remainingPeriod, oneDayPeriod / 2, 'the correct remaining period is provided');
    });

  });

  describe('challenge', function() {
    it('allows any party to submit a signed transaction with a higher nonce', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);

      var oneDayPeriod = 1 * 24 * 60 * 60;
      await openValidChannel(ledger, token, accounts[0], accounts[1], oneDayPeriod);

      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);

      // Bob signs the transaction to send 2 Ether to Alice
      var firstValue = web3.toWei('2', 'ether');
      var messageHash = web3.sha3(channelId, firstValue);
      var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      // Alice submits this transaction to the channel and closes it (with challenge period)
      await ledger.closeChannel([channelId, messageHash, r, s], v, firstValue, 1, {from: accounts[1]});

      // Bob messed up, signs a new transaction to send 1 Ether to Alice
      var finalValue = web3.toWei('1', 'ether');
      var messageHash = web3.sha3(channelId, finalValue);
      var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      // Bob submits the transaction with a higher nonce (2)
      var tx = await ledger.challenge([channelId, messageHash, r, s], v, finalValue, 2, {from: accounts[0]});

      // An event is triggered, notifying Alice of the change
      expectEvent.inTransaction(tx, 'ChannelChallenged');

      var channel = await ledger.getChannel(channelId);
      assert.equal(channel[5].toNumber(), finalValue, 'the value was updated');
    });

    it('should not allow challenges past the challenge period defined', async() => {
      var ledger = await TokenChannels.new();
      var token = await mintToken(accounts[0]);

      var oneDayPeriod = 1 * 24 * 60 * 60;
      await openValidChannel(ledger, token, accounts[0], accounts[1], oneDayPeriod);

      var channelId = await ledger.getChannelId(accounts[0], accounts[1]);

      // Bob signs the transaction to send 2 Ether to Alice
      var firstValue = web3.toWei('2', 'ether');
      var messageHash = web3.sha3(channelId, firstValue);
      var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      // Alice submits this transaction to the channel and closes it (with challenge period)
      await ledger.closeChannel([channelId, messageHash, r, s], v, firstValue, 1, {from: accounts[1]});

      // simulate 2 days passing - past the challenge period
      await increaseTime(oneDayPeriod * 2);

      // Bob wants to be sneaky, signs a new transaction to send 1 Ether to Alice
      var finalValue = web3.toWei('1', 'ether');
      var messageHash = web3.sha3(channelId, finalValue);
      var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
      var r = '0x' + sig.slice(0, 64);
      var s = '0x' + sig.slice(64, 128);
      var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;

      try {
        // Bob submits the transaction with a higher nonce (2)
        var tx = await ledger.challenge([channelId, messageHash, r, s], v, finalValue, 2, {from: accounts[0]});
      } catch (error) {
        assertRevert(error);
      }
    });
  });

  // TODO: waiting on this PR: https://github.com/trufflesuite/ganache-core/pull/2
  // describe('finalize', function() {
  //   it('allows any party to close the channel after the challenge period passes', async() => {
  //     var ledger = await TokenChannels.new();
  //     var token = await mintToken(accounts[0]);
  //
  //     var oneDayPeriod = 1 * 24 * 60 * 60;
  //     await openValidChannel(ledger, token, accounts[0], accounts[1], oneDayPeriod);
  //
  //     var channelId = await ledger.getChannelId(accounts[0], accounts[1]);
  //
  //     // Bob signs the transaction to send 2 Ether to Alice
  //     var finalValue = web3.toWei('2', 'ether');
  //     var messageHash = web3.sha3(channelId, finalValue);
  //     var sig = web3.eth.sign(accounts[0], messageHash).slice(2);
  //     var r = '0x' + sig.slice(0, 64);
  //     var s = '0x' + sig.slice(64, 128);
  //     var v = web3.toDecimal('0x' + sig.slice(128, 130)) + 27;
  //
  //     // Alice submits this transaction to the channel and closes it (with challenge period)
  //     await ledger.closeChannel([channelId, messageHash, r, s], v, finalValue, 1, {from: accounts[1]});
  //
  //     // simulate 2 days passing - past the challenge period
  //     await increaseTime((oneDayPeriod * 2));
  //
  //     // Alice wants her money, so she finalizes the channel
  //     await ledger.finalize(channelId, {from: accounts[1]});
  //
  //     var status = await ledger.getChannelStatus(channelId);
  //     assert.equal(status.toNumber(), 2, 'the channel has status set to ChannetStatus.Closed');
  //   });
  // });
});
