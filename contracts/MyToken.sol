pragma solidity ^0.4.18;

import 'zeppelin-solidity/contracts/token/MintableToken.sol';

/*
 * A MintableToken is both a StandardToken and Ownable
 */
contract MyToken is MintableToken {
  string public name;
  string public symbol;
  uint8 public decimals;

  function MyToken(string _name, string _symbol, uint8 _decimals) public {
    name = _name;
    symbol = _symbol;
    decimals = _decimals;
  }
}
