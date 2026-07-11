// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract UseReceiptRegistry {
    struct TollgateUseIntent {
        bytes32 queryHash;
        bytes32 candidateSetRoot;
        bytes32 selectedSourcesRoot;
        bytes32 decisionTraceHash;
        bytes32 claimSupportRoot;
        uint256 maxSpendAtomicUsdc;
        uint256 expiry;
        uint256 nonce;
    }

    bytes32 public constant INTENT_TYPEHASH = keccak256(
        "TollgateUseIntent(bytes32 queryHash,bytes32 candidateSetRoot,bytes32 selectedSourcesRoot,bytes32 decisionTraceHash,bytes32 claimSupportRoot,uint256 maxSpendAtomicUsdc,uint256 expiry,uint256 nonce)"
    );
    bytes32 private constant DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );
    bytes32 private constant NAME_HASH = keccak256(
        "Tollgate UseReceipt Registry"
    );
    bytes32 private constant VERSION_HASH = keccak256("1");
    uint256 private constant SECP256K1N_HALF_ORDER =
        0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    bytes32 public immutable DOMAIN_SEPARATOR;
    address public immutable tollgateAgentWallet;
    mapping(uint256 => bool) public usedNonces;

    event UseIntentAnchored(
        bytes32 indexed queryHash,
        bytes32 indexed digest,
        address indexed signer
    );

    constructor(address agentWallet) {
        require(agentWallet != address(0), "agent wallet is zero");
        tollgateAgentWallet = agentWallet;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                DOMAIN_TYPEHASH,
                NAME_HASH,
                VERSION_HASH,
                block.chainid,
                address(this)
            )
        );
    }

    function hashIntent(
        TollgateUseIntent calldata intent
    ) public view returns (bytes32) {
        bytes32 structHash = keccak256(
            abi.encode(
                INTENT_TYPEHASH,
                intent.queryHash,
                intent.candidateSetRoot,
                intent.selectedSourcesRoot,
                intent.decisionTraceHash,
                intent.claimSupportRoot,
                intent.maxSpendAtomicUsdc,
                intent.expiry,
                intent.nonce
            )
        );
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function anchor(
        TollgateUseIntent calldata intent,
        bytes calldata signature
    ) external returns (bytes32 digest) {
        require(block.timestamp <= intent.expiry, "intent expired");
        require(!usedNonces[intent.nonce], "intent nonce used");

        digest = hashIntent(intent);
        require(_recover(digest, signature) == tollgateAgentWallet, "invalid intent signer");
        usedNonces[intent.nonce] = true;
        emit UseIntentAnchored(intent.queryHash, digest, tollgateAgentWallet);
    }

    function _recover(
        bytes32 digest,
        bytes memory signature
    ) private pure returns (address signer) {
        require(signature.length == 65, "invalid signature length");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := mload(add(signature, 32))
            s := mload(add(signature, 64))
            v := byte(0, mload(add(signature, 96)))
        }
        if (v < 27) v += 27;
        require(v == 27 || v == 28, "invalid signature v");
        require(uint256(s) <= SECP256K1N_HALF_ORDER, "invalid signature s");
        signer = ecrecover(digest, v, r, s);
        require(signer != address(0), "invalid signature");
    }
}
