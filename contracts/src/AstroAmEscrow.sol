// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AstroAmEscrow
/// @notice Prepaid mobile-data escrow for Monad testnet.
///
/// The traveler deposits Circle USDC once (6 decimals). Usage is metered
/// off-chain. One `close` pays AstroAm the cumulative amount authorized by
/// the traveler's EIP-712 voucher and refunds the rest in the same
/// transaction. If AstroAm never closes, `refund` returns the full deposit
/// after `timeoutSeconds`. This contract does not debit per megabyte.
contract AstroAmEscrow {
    error ZeroAddress();
    error ZeroAmount();
    error UnexpectedDecimals();
    error EscrowExists();
    error EscrowMissing();
    error AlreadySettled();
    error NotTraveler();
    error AmountExceedsDeposit();
    error BadVoucher();
    error TimeoutNotReached();
    error TransferFailed();

    struct Escrow {
        address traveler;
        uint96 openedAt;
        uint256 deposit;
        bool settled;
    }

    /// Circle USDC uses 6 decimals. Stellar USDC in the original app used 7.
    uint8 public constant usdcDecimals = 6;

    address public immutable usdc;
    address public immutable payee;
    uint256 public immutable timeoutSeconds;

    mapping(bytes32 escrowId => Escrow) public escrows;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant VOUCHER_TYPEHASH =
        keccak256("CloseVoucher(bytes32 escrowId,uint256 cumulativeAmount)");

    event Deposited(bytes32 indexed escrowId, address indexed traveler, uint256 amount);
    event ToppedUp(bytes32 indexed escrowId, uint256 added, uint256 deposit);
    event Closed(bytes32 indexed escrowId, address indexed traveler, uint256 paid, uint256 refunded);
    event Refunded(bytes32 indexed escrowId, address indexed traveler, uint256 amount);

    constructor(address usdc_, address payee_, uint256 timeoutSeconds_) {
        if (usdc_ == address(0) || payee_ == address(0)) revert ZeroAddress();
        if (timeoutSeconds_ == 0) revert ZeroAmount();
        if (_decimalsOf(usdc_) != 6) revert UnexpectedDecimals();

        usdc = usdc_;
        payee = payee_;
        timeoutSeconds = timeoutSeconds_;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("AstroAmEscrow")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /// @notice Pull `amount` of USDC (6-decimal atomic units) from the traveler.
    function deposit(bytes32 escrowId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Escrow storage escrow = escrows[escrowId];
        if (escrow.traveler != address(0)) revert EscrowExists();

        _pull(msg.sender, amount);
        escrow.traveler = msg.sender;
        escrow.openedAt = uint96(block.timestamp);
        escrow.deposit = amount;

        emit Deposited(escrowId, msg.sender, amount);
    }

    /// @notice Add USDC to an open escrow. Only the traveler, and only before close.
    function topUp(bytes32 escrowId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Escrow storage escrow = escrows[escrowId];
        if (escrow.traveler == address(0)) revert EscrowMissing();
        if (escrow.settled) revert AlreadySettled();
        if (msg.sender != escrow.traveler) revert NotTraveler();

        _pull(msg.sender, amount);
        escrow.deposit += amount;
        emit ToppedUp(escrowId, amount, escrow.deposit);
    }

    /// @notice One settlement. `signature` is the traveler's EIP-712 voucher
    /// over `(escrowId, cumulativeAmount)`. Anyone may submit it (the traveler's
    /// wallet or AstroAm). Pays `payee` the used amount and refunds the rest.
    function close(bytes32 escrowId, uint256 cumulativeAmount, bytes calldata signature) external {
        Escrow storage escrow = escrows[escrowId];
        address traveler = escrow.traveler;
        if (traveler == address(0)) revert EscrowMissing();
        if (escrow.settled) revert AlreadySettled();
        if (cumulativeAmount > escrow.deposit) revert AmountExceedsDeposit();
        if (_recover(escrowId, cumulativeAmount, signature) != traveler) revert BadVoucher();

        uint256 refundAmount = escrow.deposit - cumulativeAmount;
        escrow.settled = true;

        if (cumulativeAmount > 0) _push(payee, cumulativeAmount);
        if (refundAmount > 0) _push(traveler, refundAmount);

        emit Closed(escrowId, traveler, cumulativeAmount, refundAmount);
    }

    /// @notice Full deposit back to the traveler if AstroAm never closed.
    function refund(bytes32 escrowId) external {
        Escrow storage escrow = escrows[escrowId];
        address traveler = escrow.traveler;
        if (traveler == address(0)) revert EscrowMissing();
        if (escrow.settled) revert AlreadySettled();
        if (block.timestamp < uint256(escrow.openedAt) + timeoutSeconds) revert TimeoutNotReached();

        uint256 amount = escrow.deposit;
        escrow.settled = true;
        _push(traveler, amount);
        emit Refunded(escrowId, traveler, amount);
    }

    function voucherHash(bytes32 escrowId, uint256 cumulativeAmount) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, escrowId, cumulativeAmount));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _recover(bytes32 escrowId, uint256 cumulativeAmount, bytes calldata signature)
        internal
        view
        returns (address)
    {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        if (v != 27 && v != 28) return address(0);
        return ecrecover(voucherHash(escrowId, cumulativeAmount), v, r, s);
    }

    function _decimalsOf(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(bytes4(keccak256("decimals()"))));
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint8));
    }

    function _pull(address from, uint256 amount) internal {
        (bool ok, bytes memory data) =
            usdc.call(abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), from, address(this), amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _push(address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            usdc.call(abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
