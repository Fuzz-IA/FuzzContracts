import { expect } from "chai";
import { ethers } from "hardhat";
import { Token,Token__factory, FuzzBetting, FuzzBetting__factory } from "../typechain-types";
import { ContractTransactionResponse, BigNumberish } from "ethers";

describe("FuzzBetting", function () {
  let token: Token;
  let betting: FuzzBetting;
  let owner: any;
  let agentA: any;
  let agentB: any;
  let user1: any;
  let user2: any;
  let user3: any;
  let user4: any;

  const PROMPT_AMOUNT = ethers.parseEther("2000");
  const PROMPT_BASE = 2000n;

  beforeEach(async function () {
    [owner, agentA, agentB, user1, user2, user3, user4] = await ethers.getSigners();

    const Token = await ethers.getContractFactory("Token") as Token__factory;
    token = await Token.deploy(owner.address);
    await token.waitForDeployment()
    const tokenAddress = await token.getAddress()

    const Betting = await ethers.getContractFactory("FuzzBetting") as FuzzBetting__factory;
    betting = await Betting.deploy(tokenAddress, agentA.address, agentB.address);
    await betting.waitForDeployment();
    const bettingAddress = await betting.getAddress()

        for(let i = 0; i < 50; i++) { 
            await token.connect(user1).mint()
            await token.connect(user2).mint()
            await token.connect(user3).mint()
            await token.connect(user4).mint()
        }

    const HIGH_ALLOWANCE = ethers.parseEther("1000000"); 
    await token.connect(user1).approve(bettingAddress, HIGH_ALLOWANCE);
    await token.connect(user2).approve(bettingAddress, HIGH_ALLOWANCE);
    await token.connect(user3).approve(bettingAddress, HIGH_ALLOWANCE);
    await token.connect(user4).approve(bettingAddress, HIGH_ALLOWANCE);
  });

  async function getPromptIdFromTx(tx: ContractTransactionResponse): Promise<BigNumberish> {
    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction failed");

    const promptBetEvent = receipt.logs.find(
      (log: any) => {
        try {
          return betting.interface.parseLog({
            topics: [...log.topics],
            data: log.data
          })?.name === "PromptBet";
        } catch {
          return false;
        }
      }
    );

    if (!promptBetEvent) throw new Error("PromptBet event not found");

    const decodedEvent = betting.interface.parseLog({
      topics: [...promptBetEvent.topics],
      data: promptBetEvent.data
    });

    return decodedEvent?.args?.promptId;
  }

  describe("Basic Configuration", function () {
      it("Should set initial state correctly", async function () {
          expect(await betting.agentA()).to.equal(agentA.address);
          expect(await betting.agentB()).to.equal(agentB.address);
          expect(await betting.currentGameId()).to.equal(1);
      });

      it("Should allow owner to add admin", async function () {
          await betting.connect(owner).addAdmin(user1.address);
          expect(await betting.admins(user1.address)).to.be.true;
      });
  });

  describe("Token Management", function () {
      it("Should track token balances correctly", async function () {
          const initialBalance = await token.balanceOf(user1.address);
          await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
          expect(await token.balanceOf(user1.address)).to.equal(initialBalance - PROMPT_BASE);
      });
  });

  describe("Betting Operations", function () {
      it("Should create prompt and bet correctly", async function () {
          const tx = await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
          const promptId = await getPromptIdFromTx(tx);

          const prompt = await betting.getPrompt(promptId);
          expect(prompt.isAgentA).to.be.true;
          expect(prompt.votes).to.equal(PROMPT_BASE);
          expect(prompt.creator).to.equal(user1.address);
      });

      it("Should allow simple betting on agent", async function () {
          await betting.connect(user1).betOnAgent(true, PROMPT_AMOUNT);
          const [forA] = await betting.getUserContribution(user1.address, 1);
          expect(forA).to.equal(PROMPT_AMOUNT);
      });

      it("Should track game prompts correctly", async function () {
          await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
          await betting.connect(user2).betWithPrompt(false, PROMPT_BASE);

          const prompts = await betting.getCurrentGamePrompts();
          expect(prompts.length).to.equal(2);
      });

      it("Should emit correct events", async function () {
          const tx = await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
          await expect(tx)
              .to.emit(betting, "PromptBet")
              .withArgs(
                  user1.address, 
                  true,           
                  PROMPT_BASE,     
                  ethers.toBigInt(await getPromptIdFromTx(tx)), 
                  1              
              );
      });
  });

  describe("Dynamic Betting System", function () {
    beforeEach(async function() {
        await betting.connect(owner).setBasePromptBetAmount(PROMPT_BASE);
    });

    it("Should initialize with correct base amounts", async function () {
        expect(await betting.basePromptBetAmount()).to.equal(PROMPT_BASE);
    });

    it("Should calculate correct amounts based on market balance", async function () {
        const [initialAmount] = await betting.calculateDynamicBetAmount(true);
        expect(initialAmount).to.equal(PROMPT_BASE);

        await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
        await betting.connect(user2).betWithPrompt(false, PROMPT_BASE);

        const [costForDominantSide] = await betting.calculateDynamicBetAmount(true);
        expect(costForDominantSide).to.equal(PROMPT_BASE);

        const [costForUnderdog] = await betting.calculateDynamicBetAmount(false);
        expect(costForUnderdog).to.equal(PROMPT_BASE);
    });

    it("Should respect minimum amount threshold", async function () {
        await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);

        const [costForUnderdog] = await betting.calculateDynamicBetAmount(false);
        expect(costForUnderdog).to.be.gte(PROMPT_BASE / 4n); 

        const minimumThreshold = PROMPT_BASE / 4n; 
        expect(costForUnderdog).to.be.gte(minimumThreshold);
    });

    it("Should track market info correctly", async function () {
        await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
        await betting.connect(user2).betWithPrompt(false, PROMPT_BASE);

        const marketInfo = await betting.getMarketInfo();
        expect(marketInfo.sideARatio).to.equal(5000);
        expect(marketInfo.costForSideA).to.equal(PROMPT_BASE);
        expect(marketInfo.costForSideB).to.equal(PROMPT_BASE);
    });

    it("Should reject bets below dynamic minimum", async function () {
        await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);

        const [requiredAmount] = await betting.calculateDynamicBetAmount(true);
        const belowRequired = requiredAmount - 1n;

        await expect(
            betting.connect(user2).betWithPrompt(true, belowRequired)
        ).to.be.revertedWith("amount must be exactly 2000 for creating a prompt");
    });

    it("Should allow betting with exact dynamic minimum", async function () {
        await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
        const [requiredAmount] = await betting.calculateDynamicBetAmount(true);

        await expect(
            betting.connect(user2).betOnAgent(true, requiredAmount)
        ).to.not.be.reverted;
    });
  });

  describe("Game Management", function () {
      it("Should complete game cycle correctly", async function () {
          await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
          await betting.connect(user2).betOnAgent(false, PROMPT_AMOUNT);

          await betting.connect(owner).endGame(true);
          expect(await betting.gameEnded()).to.be.true;

          await betting.connect(owner).resetGame();
          expect(await betting.currentGameId()).to.equal(2);
          expect(await betting.gameEnded()).to.be.false;
      });

      it("Should allow betting in new game after reset", async function () {
          await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
          await betting.connect(owner).endGame(true);
          await betting.connect(owner).resetGame();

          await expect(betting.connect(user1).betWithPrompt(true, PROMPT_BASE))
              .to.not.be.reverted;

          const prompts = await betting.getCurrentGamePrompts();
          expect(prompts.length).to.equal(1);
          expect(await betting.currentGameId()).to.equal(2);
      });

      it("Should maintain prompt history across games", async function () {
          const tx = await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
          const promptId = await getPromptIdFromTx(tx);

          await betting.connect(owner).endGame(true);
          await betting.connect(owner).resetGame();

          const prompt = await betting.getPrompt(promptId);
          expect(prompt.exists).to.be.true;
          expect(prompt.gameId).to.equal(1);
      });
  });

  describe("Error cases", function () {
    it("Should fail with insufficient bet amount", async function () {
        await betting.connect(owner).setBasePromptBetAmount(PROMPT_BASE);
        const lowAmount = PROMPT_BASE / 2n;

        await expect(
            betting.connect(user1).betWithPrompt(true, lowAmount)
        ).to.be.revertedWith("amount must be exactly 2000 for creating a prompt");
    });

      it("Should fail when non-owner tries to add admin", async function () {
          await expect(
              betting.connect(user1).addAdmin(user2.address)
          ).to.be.revertedWith("Ownable: caller is not the owner");
      });

      it("Should fail when trying to reset game before ending", async function () {
          await expect(
              betting.connect(owner).resetGame()
          ).to.be.revertedWith("Current game not ended");
      });

      describe("Already Voted Cases", function () {

          it("Should allow user to bet again in a new game after reset", async function () {
              await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);
              await betting.connect(owner).endGame(true);
              await betting.connect(owner).resetGame();

              await expect(
                  betting.connect(user1).betWithPrompt(true, PROMPT_BASE)
              ).to.not.be.reverted;
          });


      });
  });

  describe("Fee Managment and Distribution", function () {
    it("should set fees correctly", async function () {
      const newParticipationFee = 200;
      const newWinnerFee = 300;
      const newDevFee = 400;

      await betting.connect(owner).updateFees(newParticipationFee, newWinnerFee,newDevFee);

      expect(await betting.participationFeePercentage()).to.equal(newParticipationFee);
      expect(await betting.winnerFeePercentage()).to.equal(newWinnerFee);
      expect(await betting.devFeePercentage()).to.equal(newDevFee);
    })

    it("should fail when setting fees too high", async function () {
      const invalidParticipationFee = 5000;
      const invalidWinnerFee = 5001;
      const invalidDevFee = 4000;

      await expect(
          betting.connect(owner).updateFees(invalidParticipationFee, invalidWinnerFee,invalidDevFee)
      ).to.be.revertedWith("Fees too high")
    })
  })

  describe("Winnings Distribution", function () {
    beforeEach(async function () {
        for(let i = 0; i < 50; i++) {
            await token.connect(user1).mint();
            await token.connect(user2).mint();
            await token.connect(user3).mint();
            await token.connect(user4).mint();
        }

        const bettingAddress = await betting.getAddress();
        const HIGH_ALLOWANCE = ethers.parseEther("1000000");
        await token.connect(user1).approve(bettingAddress, HIGH_ALLOWANCE);
        await token.connect(user2).approve(bettingAddress, HIGH_ALLOWANCE);
        await token.connect(user3).approve(bettingAddress, HIGH_ALLOWANCE);
        await token.connect(user4).approve(bettingAddress, HIGH_ALLOWANCE);
    });

    it("Should distribute fees and winnings correctly with mixed betting types", async function () {
        const initialUser1Balance = await token.balanceOf(user1.address);
        const initialUser2Balance = await token.balanceOf(user2.address);
        const initialUser3Balance = await token.balanceOf(user3.address);
        const initialAgentABalance = await token.balanceOf(agentA.address);
        const initialAgentBBalance = await token.balanceOf(agentB.address);
        const initialOwnerBalance = await token.balanceOf(owner.address);

        await betting.connect(user1).betWithPrompt(true, PROMPT_BASE);

        const [requiredAmount] = await betting.calculateDynamicBetAmount(true);
        await betting.connect(user2).betOnAgent(true, requiredAmount);
        await betting.connect(user3).betOnAgent(false, PROMPT_AMOUNT);

        const totalAmount = PROMPT_BASE + requiredAmount + PROMPT_AMOUNT;
        const participationFee = (totalAmount * 100n) / 10000n;
        const winnerFee = (totalAmount * 400n) / 10000n;
        const devFee = (totalAmount * 450n) / 10000n;
        const participationFeePerAgent = participationFee / 2n;

        const user1Contribution = PROMPT_BASE;
        const user2Contribution = requiredAmount;
        const totalWinningContributions = user1Contribution + user2Contribution;

        await betting.connect(owner).endGame(true);

        expect(await token.balanceOf(owner.address)).to.equal(
            initialOwnerBalance + devFee
        );

        expect(await token.balanceOf(agentA.address)).to.equal(
            initialAgentABalance + participationFeePerAgent + winnerFee
        );
        expect(await token.balanceOf(agentB.address)).to.equal(
            initialAgentBBalance + participationFeePerAgent
        );

        const remainingAmount = totalAmount - participationFee - winnerFee - devFee;

        const expectedUser1Winnings = (remainingAmount * user1Contribution) / totalWinningContributions;
        const expectedUser2Winnings = (remainingAmount * user2Contribution) / totalWinningContributions;

        expect(await token.balanceOf(user1.address)).to.equal(
            initialUser1Balance - PROMPT_BASE + expectedUser1Winnings
        );
        expect(await token.balanceOf(user2.address)).to.equal(
            initialUser2Balance - requiredAmount + expectedUser2Winnings
        );
        expect(await token.balanceOf(user3.address)).to.equal(
            initialUser3Balance - PROMPT_AMOUNT
        );

        const winningsDistributedEvents = await betting.queryFilter(
            betting.filters.WinningsDistributed()
        );

        const user1WinningsEvent = winningsDistributedEvents.find(
            e => e.args.user === user1.address
        );
        const user2WinningsEvent = winningsDistributedEvents.find(
            e => e.args.user === user2.address
        );

        if (user1WinningsEvent && user2WinningsEvent) {
            expect(user1WinningsEvent.args.amount).to.equal(expectedUser1Winnings);
            expect(user2WinningsEvent.args.amount).to.equal(expectedUser2Winnings);
        }
    });
  });
});