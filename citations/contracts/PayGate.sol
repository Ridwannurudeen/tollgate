// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {UseReceiptRegistry} from "./UseReceiptRegistry.sol";

interface IERC20PayGate {
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IFeeRouterV1PayGate {
    function usdc() external view returns (address);
    function pay(uint256 splitId, uint256 amount) external;
}

contract PayGate {
    struct SplitPayment {
        uint256 splitId;
        uint256 amount;
    }

    UseReceiptRegistry public immutable registry;
    IFeeRouterV1PayGate public immutable feeRouter;
    IERC20PayGate public immutable usdc;
    address public immutable payer;

    event PaidWithIntent(
        bytes32 indexed queryHash,
        bytes32 indexed digest,
        address indexed payer,
        uint256 total
    );

    constructor(
        address registry_,
        address feeRouter_,
        address usdc_,
        address payer_
    ) {
        require(registry_ != address(0), "registry is zero");
        require(feeRouter_ != address(0), "fee router is zero");
        require(usdc_ != address(0), "usdc is zero");
        require(payer_ != address(0), "payer is zero");

        registry = UseReceiptRegistry(registry_);
        feeRouter = IFeeRouterV1PayGate(feeRouter_);
        usdc = IERC20PayGate(usdc_);
        payer = payer_;

        require(feeRouter.usdc() == usdc_, "fee router asset mismatch");
        require(
            usdc.approve(feeRouter_, type(uint256).max),
            "usdc approve failed"
        );
    }

    function payWithIntent(
        UseReceiptRegistry.TollgateUseIntent calldata intent,
        bytes calldata signature,
        SplitPayment[] calldata payments
    ) external returns (bytes32 digest) {
        require(msg.sender == payer, "invalid payer");

        uint256 total;
        for (uint256 i = 0; i < payments.length; i++) {
            require(payments[i].amount > 0, "payment amount is zero");
            total += payments[i].amount;
        }
        require(total > 0, "no payment amount");
        require(total <= intent.maxSpendAtomicUsdc, "spend exceeds intent max");

        digest = registry.anchor(intent, signature);
        require(
            usdc.transferFrom(msg.sender, address(this), total),
            "usdc pull failed"
        );
        for (uint256 i = 0; i < payments.length; i++) {
            feeRouter.pay(payments[i].splitId, payments[i].amount);
        }

        emit PaidWithIntent(intent.queryHash, digest, msg.sender, total);
    }
}
