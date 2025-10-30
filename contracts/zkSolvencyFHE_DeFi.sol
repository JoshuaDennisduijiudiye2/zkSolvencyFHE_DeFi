pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";


contract ZkSolvencyFHE is SepoliaConfig {
    using FHE for euint32;
    using FHE for ebool;

    address public owner;
    mapping(address => bool) public isProvider;
    bool public paused;
    uint256 public cooldownSeconds;
    mapping(address => uint256) public lastSubmissionTime;
    mapping(address => uint256) public lastDecryptionRequestTime;

    uint256 public currentBatchId;
    bool public batchOpen;

    struct LoanApplication {
        euint32 encryptedAssets;
        euint32 encryptedLiabilities;
        euint32 encryptedSolvencyProof;
    }
    mapping(uint256 => LoanApplication) public loanApplications; // batchId -> LoanApplication
    mapping(uint256 => DecryptionContext) public decryptionContexts;

    struct DecryptionContext {
        uint256 batchId;
        bytes32 stateHash;
        bool processed;
    }

    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ProviderAdded(address indexed provider);
    event ProviderRemoved(address indexed provider);
    event PauseToggled(bool indexed paused);
    event CooldownSecondsUpdated(uint256 indexed oldCooldown, uint256 indexed newCooldown);
    event BatchOpened(uint256 indexed batchId);
    event BatchClosed(uint256 indexed batchId);
    event LoanApplicationSubmitted(address indexed provider, uint256 indexed batchId, euint32 assets, euint32 liabilities, euint32 solvencyProof);
    event DecryptionRequested(uint256 indexed requestId, uint256 indexed batchId);
    event DecryptionCompleted(uint256 indexed requestId, uint256 indexed batchId, uint32 assets, uint32 liabilities, uint32 solvencyProof);

    error NotOwner();
    error NotProvider();
    error Paused();
    error CooldownActive();
    error BatchNotOpen();
    error BatchAlreadyOpen();
    error InvalidBatch();
    error ReplayAttempt();
    error StateMismatch();
    error DecryptionFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyProvider() {
        if (!isProvider[msg.sender]) revert NotProvider();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    modifier checkSubmissionCooldown(address _provider) {
        if (block.timestamp < lastSubmissionTime[_provider] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    modifier checkDecryptionCooldown(address _provider) {
        if (block.timestamp < lastDecryptionRequestTime[_provider] + cooldownSeconds) {
            revert CooldownActive();
        }
        _;
    }

    constructor() {
        owner = msg.sender;
        emit OwnershipTransferred(address(0), msg.sender);
        cooldownSeconds = 60; // Default cooldown
    }

    function transferOwnership(address newOwner) external onlyOwner {
        address previousOwner = owner;
        owner = newOwner;
        emit OwnershipTransferred(previousOwner, newOwner);
    }

    function addProvider(address provider) external onlyOwner {
        if (!isProvider[provider]) {
            isProvider[provider] = true;
            emit ProviderAdded(provider);
        }
    }

    function removeProvider(address provider) external onlyOwner {
        if (isProvider[provider]) {
            isProvider[provider] = false;
            emit ProviderRemoved(provider);
        }
    }

    function setPaused(bool _paused) external onlyOwner {
        paused = _paused;
        emit PauseToggled(_paused);
    }

    function setCooldownSeconds(uint256 newCooldownSeconds) external onlyOwner {
        uint256 oldCooldown = cooldownSeconds;
        cooldownSeconds = newCooldownSeconds;
        emit CooldownSecondsUpdated(oldCooldown, newCooldownSeconds);
    }

    function openBatch() external onlyOwner whenNotPaused {
        if (batchOpen) revert BatchAlreadyOpen();
        currentBatchId++;
        batchOpen = true;
        emit BatchOpened(currentBatchId);
    }

    function closeBatch() external onlyOwner whenNotPaused {
        if (!batchOpen) revert BatchNotOpen();
        batchOpen = false;
        emit BatchClosed(currentBatchId);
    }

    function submitLoanApplication(
        euint32 encryptedAssets,
        euint32 encryptedLiabilities,
        euint32 encryptedSolvencyProof
    ) external onlyProvider whenNotPaused checkSubmissionCooldown(msg.sender) {
        if (!batchOpen) revert BatchNotOpen();

        _initIfNeeded(encryptedAssets);
        _initIfNeeded(encryptedLiabilities);
        _initIfNeeded(encryptedSolvencyProof);

        loanApplications[currentBatchId] = LoanApplication({
            encryptedAssets: encryptedAssets,
            encryptedLiabilities: encryptedLiabilities,
            encryptedSolvencyProof: encryptedSolvencyProof
        });

        lastSubmissionTime[msg.sender] = block.timestamp;
        emit LoanApplicationSubmitted(msg.sender, currentBatchId, encryptedAssets, encryptedLiabilities, encryptedSolvencyProof);
    }

    function requestLoanApproval(uint256 batchId) external onlyProvider whenNotPaused checkDecryptionCooldown(msg.sender) {
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatch();

        LoanApplication storage app = loanApplications[batchId];

        _requireInitialized(app.encryptedAssets);
        _requireInitialized(app.encryptedLiabilities);
        _requireInitialized(app.encryptedSolvencyProof);

        euint32[] memory ctsToHash = new euint32[](3);
        ctsToHash[0] = app.encryptedAssets;
        ctsToHash[1] = app.encryptedLiabilities;
        ctsToHash[2] = app.encryptedSolvencyProof;

        bytes32 stateHash = _hashCiphertexts(ctsToHash);

        uint256 requestId = FHE.requestDecryption(ctsToHash, this.myCallback.selector);
        decryptionContexts[requestId] = DecryptionContext({ batchId: batchId, stateHash: stateHash, processed: false });
        lastDecryptionRequestTime[msg.sender] = block.timestamp;
        emit DecryptionRequested(requestId, batchId);
    }

    function myCallback(uint256 requestId, bytes memory cleartexts, bytes memory proof) public {
        if (decryptionContexts[requestId].processed) revert ReplayAttempt();
        // Security: Replay guard prevents processing the same decryption request multiple times.

        uint256 batchId = decryptionContexts[requestId].batchId;
        if (batchId == 0 || batchId > currentBatchId) revert InvalidBatch();

        LoanApplication storage app = loanApplications[batchId];

        euint32[] memory ctsToHash = new euint32[](3);
        ctsToHash[0] = app.encryptedAssets;
        ctsToHash[1] = app.encryptedLiabilities;
        ctsToHash[2] = app.encryptedSolvencyProof;

        bytes32 currentHash = _hashCiphertexts(ctsToHash);
        // Security: State hash verification ensures that the ciphertexts being decrypted
        // are the same ones that were committed to when the decryption was requested.
        // This prevents attacks where an adversary might try to change the data after
        // a decryption request is made but before it's processed.
        if (currentHash != decryptionContexts[requestId].stateHash) revert StateMismatch();

        if (!FHE.checkSignatures(requestId, cleartexts, proof)) revert DecryptionFailed();

        uint32 assets = abi.decode(cleartexts.slice(0, 32), (uint32));
        uint32 liabilities = abi.decode(cleartexts.slice(32, 32), (uint32));
        uint32 solvencyProof = abi.decode(cleartexts.slice(64, 32), (uint32));

        decryptionContexts[requestId].processed = true;
        emit DecryptionCompleted(requestId, batchId, assets, liabilities, solvencyProof);
        // Further logic to approve/reject loan based on decrypted values would go here
    }

    function _hashCiphertexts(euint32[] memory cts) internal pure returns (bytes32) {
        bytes32[] memory ctsAsBytes = new bytes32[](cts.length);
        for (uint i = 0; i < cts.length; i++) {
            ctsAsBytes[i] = FHE.toBytes32(cts[i]);
        }
        return keccak256(abi.encode(ctsAsBytes, address(this)));
    }

    function _initIfNeeded(euint32 val) internal {
        if (!FHE.isInitialized(val)) FHE.asEuint32(0); // Dummy init if not already
    }

    function _requireInitialized(euint32 val) internal view {
        if (!FHE.isInitialized(val)) revert("Ciphertext not initialized");
    }
}