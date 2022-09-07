const truffleAssert = require("truffle-assertions");
const {
  encodeERC721SafeTransferFrom,
  encodeERC1155SafeTransferFrom,
  deployProxy,
} = require("./utils");
const TokenOwnedWallet = artifacts.require("TokenOwnedWallet");
const TokenOwnedWalletProxy = artifacts.require("TokenOwnedWalletProxy");
const TokenOwnedWalletRegistry = artifacts.require("TokenOwnedWalletRegistry");
const Migration = artifacts.require("Migration");
const ERC1155 = artifacts.require("@manifoldxyz/creator-core-solidity/MockERC1155");
const ERC721 = artifacts.require("@manifoldxyz/creator-core-solidity/MockERC721");

contract("TokenOwnedWallet", function ([owner, newOwner, contractCreator]) {
  let erc721Contract;
  let registry;
  let implementation;
  let contract;

  beforeEach(async () => {
    erc721Contract = await ERC721.new("foo", "FOO", { from: owner });
    await erc721Contract.testMint(owner, 1, { from: owner });
    implementation = await TokenOwnedWallet.new({ from: contractCreator });
    registry = await TokenOwnedWalletRegistry.new(implementation.address, {
      from: contractCreator,
    });
    contract = await deployProxy(registry, erc721Contract.address, 1, contractCreator);
  });

  it("initializes correctly", async () => {
    expect(contract);
  });

  it("fails to initialize if contract is not erc721", async () => {
    const erc1155Contract = await ERC1155.new("");
    await truffleAssert.fails(
      contract.initialize(erc1155Contract.address, 1, { from: contractCreator }),
      "Owning contract must be ERC721."
    );
  });

  it("can't be initialized twice", async () => {
    await truffleAssert.reverts(
      contract.initialize(erc721Contract.address, 1, { from: contractCreator }),
      "Already initialized"
    );
  });

  it("uses owner of erc721 token as owner of TokenOwnedWallet", async () => {
    assert.equal(await contract.owner(), owner);
    await erc721Contract.safeTransferFrom(owner, newOwner, 1, { from: owner });
    assert.equal(await contract.owner(), newOwner);
  });

  it("cannot own the token that owns the TokenOwnedWallet", async () => {
    await truffleAssert.reverts(
      erc721Contract.safeTransferFrom(owner, contract.address, 1, { from: owner }),
      "Token in ownership chain."
    );
  });

  it("cannot own the token that is in ownership chain of the TokenOwnedWallet", async () => {
    await erc721Contract.testMint(owner, 2, { from: owner });
    const tokenOwnedWallet = await deployProxy(
      registry,
      erc721Contract.address,
      2,
      contractCreator
    );

    const erc721Contract2 = await ERC721.new("foo", "FOO", { from: owner });
    await erc721Contract2.testMint(owner, 1, { from: owner });
    const tokenOwnedWallet2 = await deployProxy(
      registry,
      erc721Contract2.address,
      1,
      contractCreator
    );

    // Move token that holds main TokenOwnedWallet into another token's TokenOwnedWallet
    await erc721Contract.safeTransferFrom(owner, tokenOwnedWallet2.address, 1, { from: owner });

    // Move that other token into anothers token's TokenOwnedWallet
    await erc721Contract2.safeTransferFrom(owner, tokenOwnedWallet.address, 1, { from: owner });

    contract = await deployProxy(registry, erc721Contract2.address, 1, contractCreator);

    // Ensure you can't send root token to main TokenOwnedWallet
    await truffleAssert.reverts(
      erc721Contract.safeTransferFrom(owner, contract.address, 2, { from: owner }),
      "Token in ownership chain."
    );
  });

  it("can own erc721s", async () => {
    const erc721Contract2 = await ERC721.new("foo2", "FOO2", { from: owner });
    await erc721Contract2.testMint(owner, 1, { from: owner });
    await erc721Contract2.safeTransferFrom(owner, contract.address, 1, { from: owner });
    assert.equal(await erc721Contract2.balanceOf(contract.address), 1);
  });

  it("can own erc1155s", async () => {
    const erc1155Contract = await ERC1155.new("");
    await erc1155Contract.testMint(owner, 1, 1, "0x", { from: owner });
    await erc1155Contract.safeTransferFrom(owner, contract.address, 1, 1, "0x", { from: owner });
    assert.equal(await erc1155Contract.balanceOf(contract.address, 1), 1);
  });

  describe("TokenOwnedWallet.execTransaction", () => {
    let erc721Contract2;
    beforeEach(async () => {
      erc721Contract2 = await ERC721.new("foo2", "FOO2", { from: owner });
      await erc721Contract2.testMint(owner, 1, { from: owner });
    });

    it("cannot execute a transaction if not the owner", async () => {
      const encodedSafeTransferFrom = encodeERC721SafeTransferFrom(contract.address, newOwner, 1);
      await truffleAssert.reverts(
        contract.execTransaction(erc721Contract2.address, 0, encodedSafeTransferFrom, 0, {
          from: newOwner,
        }),
        "Caller is not owner"
      );
    });

    it("can transfer an erc721 owned by the TokenOwnedWallet", async () => {
      await erc721Contract2.safeTransferFrom(owner, contract.address, 1, { from: owner });
      assert.equal(await erc721Contract2.balanceOf(contract.address), 1);
      const encodedSafeTransferFrom = encodeERC721SafeTransferFrom(contract.address, newOwner, 1);
      await contract.execTransaction(erc721Contract2.address, 0, encodedSafeTransferFrom, 0, {
        from: owner,
      }),
        assert.equal(await erc721Contract2.balanceOf(newOwner), 1);
    });

    it("can transfer an erc1155 owned by the TokenOwnedWallet", async () => {
      const erc1155Contract = await ERC1155.new("");
      await erc1155Contract.testMint(owner, 1, 1, "0x", { from: owner });
      await erc1155Contract.safeTransferFrom(owner, contract.address, 1, 1, "0x", { from: owner });
      assert.equal(await erc1155Contract.balanceOf(contract.address, 1), 1);
      const encodedSafeTransferFrom = encodeERC1155SafeTransferFrom(
        contract.address,
        newOwner,
        1,
        1
      );
      await contract.execTransaction(erc1155Contract.address, 0, encodedSafeTransferFrom, 0, {
        from: owner,
      });
      assert.equal(await erc1155Contract.balanceOf(newOwner, 1), 1);
    });

    it("can upgrade wallet implementation", async () => {
      const newImplementation = await TokenOwnedWallet.new({ from: contractCreator });
      const migration = await Migration.new(newImplementation.address, { from: contractCreator });
      const encodedUpgrade = web3.eth.abi.encodeFunctionCall(
        {
          inputs: [],
          name: "migrate",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function",
        },
        []
      );
      truffleAssert.passes(
        contract.execTransaction(migration.address, 0, encodedUpgrade, 1, {
          from: owner,
        })
      );
      const proxy = await TokenOwnedWalletProxy.at(contract.address);
      assert.equal(await proxy.implementation(), newImplementation.address);
    });
  });
});
