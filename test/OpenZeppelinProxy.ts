import {
  time,
  loadFixture,
} from "@nomicfoundation/hardhat-toolbox/network-helpers";
import { anyValue } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { expect } from "chai";
import hre from "hardhat";

const ImplementationLabel = "eip1967.proxy.implementation";
const AdminLabel = "eip1967.proxy.admin";

const erc1967Slot = (label: string) =>
  hre.ethers.toBeHex(hre.ethers.toBigInt(hre.ethers.id(label)) - 1n);

const getSlot = (address: string, slot: string) =>
  hre.ethers.provider.getStorage(
    address,
    hre.ethers.isBytesLike(slot) ? slot : erc1967Slot(slot),
  );

const getAddressInSlot = (address: string, slot: string) =>
  getSlot(address, slot).then(
    (slotValue) =>
      hre.ethers.AbiCoder.defaultAbiCoder().decode(["address"], slotValue)[0],
  );

describe("OpenZeppelinProxy", () => {
  const deployFixture = async () => {
    const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
    const ONE_GWEI = 1_000_000_000;

    const lockedAmount = ONE_GWEI;
    const unlockTime = (await time.latest()) + ONE_YEAR_IN_SECS;

    const [owner, otherAccount] = await hre.ethers.getSigners();

    const Lock = await hre.ethers.getContractFactory("LockUpgradeable");
    const lock = await Lock.deploy();
    const iface = new hre.ethers.Interface([
      "function initialize(uint _unlockTime)",
    ]);
    const initialData = iface.encodeFunctionData("initialize", [unlockTime]);

    const Proxy = await hre.ethers.getContractFactory(
      "TransparentUpgradeableProxy",
    );
    const proxy = await Proxy.deploy(lock.target, owner.address, initialData, {
      value: lockedAmount,
    });

    const proxyAdmin = await hre.ethers.getContractAt(
      "ProxyAdmin",
      hre.ethers.getCreateAddress({ from: proxy.target as string, nonce: 1n }),
    );

    return {
      lock,
      unlockTime,
      lockedAmount,
      proxy,
      proxyAdmin,
      owner,
      otherAccount,
    };
  };

  describe("Deployment", () => {
    it("Should set the right implementation", async () => {
      const { lock, proxy } = await loadFixture(deployFixture);

      const address = await getAddressInSlot(
        proxy.target as string,
        erc1967Slot(ImplementationLabel),
      );
      expect(address).to.equal(lock.target);
    });

    it("Should set the right admin", async () => {
      const { proxy, proxyAdmin } = await loadFixture(deployFixture);

      const address = await getAddressInSlot(
        proxy.target as string,
        erc1967Slot(AdminLabel),
      );
      expect(address).to.equal(proxyAdmin.target);
    });

    it("Should set the right owner", async () => {
      const { proxyAdmin, owner } = await loadFixture(deployFixture);

      expect(await proxyAdmin.owner()).to.equal(owner.address);
    });

    it("Should set the right unlockTime", async () => {
      const { proxy, unlockTime } = await loadFixture(deployFixture);
      const lock = await hre.ethers.getContractAt(
        "LockUpgradeable",
        proxy.target,
      );

      expect(await lock.unlockTime()).to.equal(unlockTime);
    });

    it("Should set the right owner", async () => {
      const { proxy, owner } = await loadFixture(deployFixture);
      const lock = await hre.ethers.getContractAt(
        "LockUpgradeable",
        proxy.target,
      );

      expect(await lock.owner()).to.equal(owner.address);
    });

    it("Should receive and store the funds to lock", async () => {
      const { proxy, lockedAmount } = await loadFixture(deployFixture);
      const lock = await hre.ethers.getContractAt(
        "LockUpgradeable",
        proxy.target,
      );

      expect(await hre.ethers.provider.getBalance(lock.target)).to.equal(
        lockedAmount,
      );
    });
  });

  describe("Upgrade", () => {
    it("Should revert when upgrade not yet", async () => {
      const { proxy, lockedAmount } = await loadFixture(deployFixture);
      const lock = await hre.ethers.getContractAt(
        "LockUpgradeableV2",
        proxy.target,
      );

      const withdrawalValue = lockedAmount - 1000;
      await expect(lock.withdraw(withdrawalValue)).to.be.reverted;
    });

    it("Should success when after upgrade", async () => {
      const { proxy, proxyAdmin, lockedAmount, owner } =
        await loadFixture(deployFixture);

      const ONE_YEAR_IN_SECS = 365 * 24 * 60 * 60;
      const unlockTime = (await time.latest()) + ONE_YEAR_IN_SECS;

      const LockV2 = await hre.ethers.getContractFactory("LockUpgradeableV2");
      const lockV2 = await LockV2.deploy();
      const iface = new hre.ethers.Interface([
        "function initialize(uint _unlockTime)",
      ]);
      const initialData = iface.encodeFunctionData("initialize", [unlockTime]);

      await proxyAdmin
        .connect(owner)
        .upgradeAndCall(proxy.target, lockV2.target, initialData);

      const lock = await hre.ethers.getContractAt(
        "LockUpgradeableV2",
        proxy.target,
      );

      await time.increaseTo(unlockTime);

      await expect(lock.withdraw(1000)).not.to.be.reverted;
      expect(await hre.ethers.provider.getBalance(lock.target)).to.equal(
        lockedAmount - 1000,
      );
    });
  });

  describe("Withdrawals", () => {
    describe("Validations", () => {
      it("Should revert with the right error if called too soon", async () => {
        const { proxy } = await loadFixture(deployFixture);
        const lock = await hre.ethers.getContractAt(
          "LockUpgradeable",
          proxy.target,
        );

        await expect(lock.withdraw()).to.be.revertedWith(
          "You can't withdraw yet",
        );
      });

      it("Should revert with the right error if called from another account", async () => {
        const { proxy, unlockTime, otherAccount } =
          await loadFixture(deployFixture);
        const lock = await hre.ethers.getContractAt(
          "LockUpgradeable",
          proxy.target,
        );

        // We can increase the time in Hardhat Network
        await time.increaseTo(unlockTime);

        // We use lock.connect() to send a transaction from another account
        await expect(lock.connect(otherAccount).withdraw()).to.be.revertedWith(
          "You aren't the owner",
        );
      });

      it("Shouldn't fail if the unlockTime has arrived and the owner calls it", async () => {
        const { proxy, unlockTime } = await loadFixture(deployFixture);
        const lock = await hre.ethers.getContractAt(
          "LockUpgradeable",
          proxy.target,
        );

        // Transactions are sent using the first signer by default
        await time.increaseTo(unlockTime);

        await expect(lock.withdraw()).not.to.be.reverted;
      });
    });

    describe("Events", () => {
      it("Should emit an event on withdrawals", async () => {
        const { proxy, unlockTime, lockedAmount } =
          await loadFixture(deployFixture);
        const lock = await hre.ethers.getContractAt(
          "LockUpgradeable",
          proxy.target,
        );

        await time.increaseTo(unlockTime);

        await expect(lock.withdraw())
          .to.emit(lock, "Withdrawal")
          .withArgs(lockedAmount, anyValue); // We accept any value as `when` arg
      });
    });

    describe("Transfers", () => {
      it("Should transfer the funds to the owner", async () => {
        const { proxy, unlockTime, lockedAmount, owner } =
          await loadFixture(deployFixture);
        const lock = await hre.ethers.getContractAt(
          "LockUpgradeable",
          proxy.target,
        );

        await time.increaseTo(unlockTime);

        await expect(lock.withdraw()).to.changeEtherBalances(
          [owner, lock],
          [lockedAmount, -lockedAmount],
        );
      });
    });
  });
});
