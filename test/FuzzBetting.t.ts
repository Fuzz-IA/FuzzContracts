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
          await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
          expect(await token.balanceOf(user1.address)).to.equal(initialBalance - PROMPT_AMOUNT);
      });
  });

  describe("Betting Operations", function () {
      it("Should create prompt and bet correctly", async function () {
          const tx = await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
          const promptId = await getPromptIdFromTx(tx);

          const prompt = await betting.getPrompt(promptId);
          expect(prompt.isAgentA).to.be.true;
          expect(prompt.votes).to.equal(PROMPT_AMOUNT);
          expect(prompt.creator).to.equal(user1.address);
      });

      it("Should allow simple betting on agent", async function () {
          await betting.connect(user1).betOnAgent(true, PROMPT_AMOUNT);
          const [forA] = await betting.getUserContribution(user1.address, 1);
          expect(forA).to.equal(PROMPT_AMOUNT);
      });

      it("Should track game prompts correctly", async function () {
          await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
          await betting.connect(user2).betWithPrompt(false, PROMPT_AMOUNT);

          const prompts = await betting.getCurrentGamePrompts();
          expect(prompts.length).to.equal(2);
      });

      it("Should emit correct events", async function () {
          const tx = await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
          await expect(tx)
              .to.emit(betting, "PromptBet")
              .withArgs(
                  user1.address, 
                  true,           
                  PROMPT_AMOUNT,     
                  ethers.toBigInt(await getPromptIdFromTx(tx)), 
                  1              
              );
      });

      it("Should allow multiple bets and prompts from same user", async function () {
          await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
          await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
          await betting.connect(user1).betWithPrompt(false, PROMPT_AMOUNT);

          const [requiredAmount] = await betting.calculateDynamicBetAmount(true);
          await betting.connect(user1).betOnAgent(true, requiredAmount);
          await betting.connect(user1).betOnAgent(false, requiredAmount);

          const prompts = await betting.getCurrentGamePrompts();
          expect(prompts.length).to.equal(3);

          const [forA, forB] = await betting.getUserContribution(user1.address, 1);
          expect(forA).to.equal(PROMPT_AMOUNT * 2n + requiredAmount);
          expect(forB).to.equal(PROMPT_AMOUNT + requiredAmount);
      });
  });

  describe("Dynamic Betting System", function () {
    beforeEach(async function() {
        await betting.connect(owner).setBasePromptBetAmount(PROMPT_AMOUNT);
    });

    it("Should initialize with correct base amounts", async function () {
        expect(await betting.basePromptBetAmount()).to.equal(PROMPT_AMOUNT);
    });

    it("Should calculate correct amounts based on market balance", async function () {
        const [initialAmount] = await betting.calculateDynamicBetAmount(true);
        expect(initialAmount).to.equal(PROMPT_AMOUNT);

        await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
        await betting.connect(user2).betWithPrompt(false, PROMPT_AMOUNT);

        const [costForDominantSide] = await betting.calculateDynamicBetAmount(true);
        expect(costForDominantSide).to.equal(PROMPT_AMOUNT);

        const [costForUnderdog] = await betting.calculateDynamicBetAmount(false);
        expect(costForUnderdog).to.equal(PROMPT_AMOUNT);
    });

    it("Should respect minimum amount threshold", async function () {
        await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);

        const [costForUnderdog] = await betting.calculateDynamicBetAmount(false);
        expect(costForUnderdog).to.be.gte(PROMPT_AMOUNT / 4n); 

        const minimumThreshold = PROMPT_AMOUNT / 4n; 
        expect(costForUnderdog).to.be.gte(minimumThreshold);
    });

    it("Should track market info correctly", async function () {
        await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
        await betting.connect(user2).betWithPrompt(false, PROMPT_AMOUNT);

        const marketInfo = await betting.getMarketInfo();
        expect(marketInfo.sideARatio).to.equal(5000);
        expect(marketInfo.costForSideA).to.equal(PROMPT_AMOUNT);
        expect(marketInfo.costForSideB).to.equal(PROMPT_AMOUNT);
    });

    it("Should reject bets below dynamic minimum", async function () {
        await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);

        const [requiredAmount] = await betting.calculateDynamicBetAmount(true);
        const belowRequired = requiredAmount - 1n;

        await expect(
            betting.connect(user2).betWithPrompt(true, belowRequired)
        ).to.be.revertedWith("amount must be exactly 2000 for creating a prompt");
    });

    it("Should allow betting with exact dynamic minimum", async function () {
        await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
        const [requiredAmount] = await betting.calculateDynamicBetAmount(true);

        await expect(
            betting.connect(user2).betOnAgent(true, requiredAmount)
        ).to.not.be.reverted;
    });
  });

  describe("Game Management", function () {
    it("Should reset game state completely after endGame", async function () {
        await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
        await betting.connect(user2).betOnAgent(false, PROMPT_AMOUNT);
        const initialGameId = await betting.currentGameId();
        
        await betting.connect(owner).endGame(true);
        
        expect(await betting.currentGameId()).to.equal(initialGameId + 1n);
        expect(await betting.gameEnded()).to.be.false;
        expect(await betting.totalAgentA()).to.equal(0);
        expect(await betting.totalAgentB()).to.equal(0);
        expect(await betting.promptCounter()).to.equal(0);
        
        const [forA, forB] = await betting.getUserContribution(user1.address, initialGameId + 1n);
        expect(forA).to.equal(0);
        expect(forB).to.equal(0);
        
        await expect(betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT))
            .to.not.be.reverted;
            
        const newPrompts = await betting.getCurrentGamePrompts();
        expect(newPrompts.length).to.equal(1);
    });

      it("Should allow betting in new game after reset", async function () {
          await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
          await betting.connect(owner).endGame(true);


          await expect(betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT))
              .to.not.be.reverted;

          const prompts = await betting.getCurrentGamePrompts();
          expect(prompts.length).to.equal(1);
          expect(await betting.currentGameId()).to.equal(2);
      });

      it("Should maintain prompt history across games", async function () {
          const tx = await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
          const promptId = await getPromptIdFromTx(tx);

          await betting.connect(owner).endGame(true);

          const prompt = await betting.getPrompt(promptId);
          expect(prompt.exists).to.be.true;
          expect(prompt.gameId).to.equal(1);
      });
  });

  describe("Error cases", function () {
    it("Should fail with insufficient bet amount", async function () {
        await betting.connect(owner).setBasePromptBetAmount(PROMPT_AMOUNT);
        const lowAmount = PROMPT_AMOUNT / 2n;

        await expect(
            betting.connect(user1).betWithPrompt(true, lowAmount)
        ).to.be.revertedWith("amount must be exactly 2000 for creating a prompt");
    });

      it("Should fail when non-owner tries to add admin", async function () {
          await expect(
              betting.connect(user1).addAdmin(user2.address)
          ).to.be.revertedWith("Ownable: caller is not the owner");
      });



      describe("Already Voted Cases", function () {

          it("Should allow user to bet again in a new game after reset", async function () {
              await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);
              await betting.connect(owner).endGame(true);

              await expect(
                  betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT)
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

        await betting.connect(user1).betWithPrompt(true, PROMPT_AMOUNT);

        const [requiredAmount] = await betting.calculateDynamicBetAmount(true);
        await betting.connect(user2).betOnAgent(true, requiredAmount);
        await betting.connect(user3).betOnAgent(false, PROMPT_AMOUNT);

        const totalAmount = PROMPT_AMOUNT + requiredAmount + PROMPT_AMOUNT;
        const participationFee = (totalAmount * 100n) / 10000n;
        const winnerFee = (totalAmount * 400n) / 10000n;
        const devFee = (totalAmount * 450n) / 10000n;
        const participationFeePerAgent = participationFee / 2n;

        const user1Contribution = PROMPT_AMOUNT;
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
            initialUser1Balance - PROMPT_AMOUNT + expectedUser1Winnings
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