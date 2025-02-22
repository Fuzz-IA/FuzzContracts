// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";


contract FuzzBetting is Ownable {
    IERC20 public token;

    address public agentA;
    address public agentB;

    uint256 public totalAgentA;
    uint256 public totalAgentB;
    uint256 public currentGameId;
    uint256 public promptCounter;
    uint256 public participationFeePercentage = 100;
    uint256 public winnerFeePercentage = 400;
    uint256 public devFeePercentage = 450;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public basePromptBetAmount = 2000;
    uint256 public constant RATIO_PRECISION = 10000;
    uint256 public constant DECIMALS = 18;

    bool public gameEnded;

    struct Prompt {
        bool isAgentA;
        uint256 votes;
        bool exists;
        address creator;
        uint256 gameId;
    }

    mapping(uint256 => mapping(address => uint256)) public userToAgentAByGame;
    mapping(uint256 => mapping(address => uint256)) public userToAgentBByGame;
    mapping(address => bool) public admins;
    mapping(uint256 => Prompt) public prompts;
    mapping(uint256 => uint256[]) public gamePrompts;
    mapping(uint256 => address[]) public gameParticipants;
    mapping(uint256 => mapping(address => bool)) public isParticipant;

    event PromptBet(address indexed user, bool isAgentA, uint256 amount, uint256 promptId, uint256 gameId);
    event SimpleBet(address indexed user, bool isAgentA, uint256 amount, uint256 gameId);
    event GameEnded(address winner, uint256 totalAmount, uint256 gameId);
    event AdminAdded(address admin);
    event AdminRemoved(address admin);
    event GameReset(uint256 newGameId);
    event MinBetAmountUpdated(uint256 newAmount);
    event FeesUpdated(uint256 participationFee, uint256 winnerFee, uint256 devFee);
    event WinningsDistributed(address user, uint256 amount);
    event BasePromptBetAmountUpdated(uint256 newAmount);
    



    modifier onlyAdmin() {
        require(admins[msg.sender] || msg.sender == owner(),"not Authorized");
        _;
    }

    constructor(address _tokenAddress, address _agentA, address _agentB) Ownable() {
        require(_tokenAddress != address(0), "Invalid token address");
        require(_agentA != address(0) && _agentB != address(0), "Invalid agent address");
        require(_agentA != _agentB, "Agents must be different");

        token = IERC20(_tokenAddress);
        agentA = _agentA;
        agentB = _agentB;
        admins[msg.sender] = true;
        currentGameId = 1;    
    }
    
    function setBasePromptBetAmount(uint256 _newAmount) external onlyAdmin {
        require(_newAmount > 0, "Base amount must be greater than 0");
        basePromptBetAmount = _newAmount;
        emit BasePromptBetAmountUpdated(_newAmount);
    }

    function addParticipant(address _better) internal {
        if (!isParticipant[currentGameId][_better]) {
            gameParticipants[currentGameId].push(_better);
            isParticipant[currentGameId][_better] = true;
        }
    }

    function addAdmin(address _admin) external onlyOwner {
        require(_admin != address(0), "Invalid admin address");
        admins[_admin] = true;
        emit AdminAdded(_admin);
    }

    
    function calculateDynamicBetAmount(bool isAgentA) public view returns ( uint256 requiredAmount, uint256 ratio) {
        
        uint256 totalBets = totalAgentA + totalAgentB;
        
        if (totalBets == 0){
            return (basePromptBetAmount, RATIO_PRECISION / 2);
        }
        
        if(isAgentA) {
            ratio = (totalAgentA * RATIO_PRECISION) / totalBets;
        } else {
            ratio = (totalAgentB * RATIO_PRECISION) / totalBets;
        }
        
        if (ratio > RATIO_PRECISION / 2) {
            uint256 excess = ratio - (RATIO_PRECISION/ 2);
            requiredAmount= basePromptBetAmount + (basePromptBetAmount * excess * excess) /
            (RATIO_PRECISION * 100);
        } else {
            
            requiredAmount = basePromptBetAmount -
            (basePromptBetAmount * (RATIO_PRECISION /2 - ratio)) / (RATIO_PRECISION *2);
        }
        
        if (requiredAmount < basePromptBetAmount / 4) {
            requiredAmount= basePromptBetAmount/ 4;
        }
        return (requiredAmount, ratio);
    }

    function betWithPrompt(bool _isAgentA, uint256 _amount) external returns (uint256) {
        require(!gameEnded, "Game has ended");
        require(_amount == basePromptBetAmount,"amount must be exactly 2000 for creating a prompt");
        require(_amount > 0, "Amount must be greater than 0");

        token.transferFrom(msg.sender, address(this), _amount);
        addParticipant(msg.sender);

        promptCounter++;
        uint256 promptId = currentGameId * 100000 + promptCounter;

        if(_isAgentA) {
            userToAgentAByGame[currentGameId][msg.sender] += _amount;
            totalAgentA += _amount;
        } else {
            userToAgentBByGame[currentGameId][msg.sender] += _amount;
            totalAgentB += _amount;
        }

        prompts[promptId] = Prompt({
            isAgentA: _isAgentA,
            votes: _amount,
            exists: true,
            creator: msg.sender,
            gameId: currentGameId
        });

        gamePrompts[currentGameId].push(promptId);

        emit PromptBet(msg.sender, _isAgentA, _amount, promptId, currentGameId);
        return promptId;
    }
    
    function getMarketInfo() external view returns (
        uint256 sideARatio,
        uint256 sideBRatio,
        uint256 costForSideA,
        uint256 costForSideB
    ) {
        uint256 totalBets = totalAgentA + totalAgentB;
        
        if (totalBets == 0) {
            return (
                RATIO_PRECISION /2,
                RATIO_PRECISION /2,
                basePromptBetAmount,
                basePromptBetAmount
            );
        }
        
        sideARatio = (totalAgentA * RATIO_PRECISION) / totalBets;
        sideBRatio = RATIO_PRECISION - sideARatio;
        
        (costForSideA,) = calculateDynamicBetAmount(true);
        (costForSideB,) = calculateDynamicBetAmount(false);
        
        return(sideARatio, sideBRatio, costForSideA, costForSideB);
    }

    function getGamePrompts(uint256 _gameId) external view returns (Prompt[] memory) {
        require(_gameId > 0 && _gameId <= currentGameId, "Invalid gameId");

        uint256[] storage promptIds = gamePrompts[_gameId];
        Prompt[] memory gamePromptList = new Prompt[](promptIds.length);

        for (uint i = 0; i < promptIds.length; i++) {
            gamePromptList[i] = prompts[promptIds[i]];
        }

        return gamePromptList;
    }

    function betOnAgent(bool _isAgentA, uint256 _amount) external {
        require(!gameEnded, "Game has ended");
        (uint256 requiredAmount,) = calculateDynamicBetAmount(_isAgentA);
        require(_amount >= requiredAmount, "Amount below dynamic minimum for current market condition");
        require(_amount > 0, "Amount must be greater than 0");

        token.transferFrom(msg.sender, address(this), _amount);
        addParticipant(msg.sender);

        if(_isAgentA) {
            userToAgentAByGame[currentGameId][msg.sender] += _amount;
            totalAgentA += _amount;
        } else {
            userToAgentBByGame[currentGameId][msg.sender] += _amount;
            totalAgentB += _amount;
        }

        emit SimpleBet(msg.sender, _isAgentA, _amount, currentGameId);
    }

    function getPrompt(uint256 _promptId) external view returns (Prompt memory) {
        require(prompts[_promptId].exists, "Prompt doesn't exist");
        return prompts[_promptId];
    }

    function getCurrentGamePrompts() external view returns (Prompt[] memory) {
        uint256[] storage promptIds = gamePrompts[currentGameId];
        Prompt[] memory gamePromptList = new Prompt[](promptIds.length);

        for (uint i=0; i< promptIds.length; i++) {
            gamePromptList[i] = prompts[promptIds[i]];
        }
        return gamePromptList;
    }

    function getTotalAcumulated() public view returns (uint256) {
        return totalAgentA + totalAgentB;
    }


    function getUserContribution(address _user,uint256 _gameId) external view returns (uint256 forA, uint256 forB) {
        return (userToAgentAByGame[_gameId][_user], userToAgentBByGame[_gameId][_user]);
    }

    function updateFees(uint256 _participationFee, uint256 _winnerFee, uint256 _devFee) external onlyAdmin {
        require(_participationFee + _winnerFee + _devFee< FEE_DENOMINATOR, "Fees too high");
        participationFeePercentage = _participationFee;
        winnerFeePercentage = _winnerFee;
        devFeePercentage = _devFee;
        emit FeesUpdated(_participationFee, _winnerFee, _devFee);
    }

    function endGame(bool _isAgentAWinner) external onlyAdmin {
        require(!gameEnded, "Game has ended");
        require(getTotalAcumulated() > 0, "No tokens to distribute");


        gameEnded = true;

        address winner = _isAgentAWinner ? agentA : agentB;
        address loser = _isAgentAWinner ? agentB : agentA;
        uint256 totalAmount = getTotalAcumulated();
        uint256 winningTotal = _isAgentAWinner ? totalAgentA : totalAgentB;
        require(winningTotal > 0, "No winning bets");

        uint256 participationFeeAmount = (totalAmount * participationFeePercentage) / FEE_DENOMINATOR;
        uint256 winnerFeeAmount = (totalAmount * winnerFeePercentage) / FEE_DENOMINATOR;
        uint256 devFeeAmount = (totalAmount * devFeePercentage) / FEE_DENOMINATOR;
        uint256 participationFeePerAgent = participationFeeAmount /2 ;

        require(token.transfer(owner(),devFeeAmount), "Dev Fee transfer failed");
        require(token.transfer(winner, participationFeePerAgent + winnerFeeAmount),"Winner fee transfer failed");
        require(token.transfer(loser, participationFeePerAgent), "Loser fee transfer failed");

        uint256 remainingAmount = totalAmount - participationFeeAmount - winnerFeeAmount - devFeeAmount;

        mapping(address => uint256) storage winnerBets = _isAgentAWinner ?
        userToAgentAByGame[currentGameId] :
        userToAgentBByGame[currentGameId];

        address[] storage participants = gameParticipants[currentGameId];
        for (uint256 i = 0; i < participants.length; i++) {
            address participant = participants[i];
            uint256 contribution = winnerBets[participant];
            if (contribution > 0) {
                uint256 share = (remainingAmount * contribution) / winningTotal;
                require(token.transfer(participant, share), "Transfer failed");
                emit WinningsDistributed(participant, share);
            }
        }

        emit GameEnded(winner, totalAmount, currentGameId);
    }


    function resetGame() external onlyAdmin {
        require(gameEnded, "Current game not ended");

        address[] storage participants = gameParticipants[currentGameId];
        for(uint i = 0; i < participants.length; i++) {
            isParticipant[currentGameId][participants[i]] = false;
        }

        gameEnded = false;
        totalAgentA = 0;
        totalAgentB = 0;
        promptCounter = 0;
        currentGameId++;

        emit GameReset(currentGameId);
    }
}