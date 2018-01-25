var TokenChannels = artifacts.require("./TokenChannels.sol");
var MyToken  = artifacts.require("./MyToken");

module.exports = function(deployer) {
  deployer.deploy(TokenChannels);
  deployer.deploy(MyToken);
};
