// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AstroAmEscrow
/// @notice One-way payment channel for prepaid mobile data on Monad.
///
/// The traveler deposits Circle USDC (6 decimals) once and registers a session
/// key. While the traveler browses, the app signs EIP-712 vouchers with that
/// key for the running total it authorizes — off-chain, no gas per megabyte.
/// AstroAm closes the channel once: it is paid what was actually used, capped
/// by the highest voucher, and the rest goes back to the traveler in the same
/// transaction. If AstroAm never closes, `refund` returns the whole deposit
/// after `timeoutSeconds`.
contract AstroAmEscrow {
    error ZeroAddress();
    error ZeroAmount();
    error UnexpectedDecimals();
    error EscrowExists();
    error EscrowMissing();
    error AlreadySettled();
    error NotTraveler();
    error NotPayee();
    error AmountExceedsDeposit();
    error SettleExceedsVoucher();
    error BadVoucher();
    error TimeoutNotReached();
    error TransferFailed();

    struct Escrow {
        address traveler;
        uint64 openedAt;
        bool settled;
        /// Session key that signs vouchers for this escrow (set by the traveler).
        address signer;
        uint256 deposit;
    }

    uint8 public constant usdcDecimals = 6;
    /// secp256k1n / 2: signatures with a higher `s` are malleable (EIP-2).
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public immutable usdc;
    address public immutable payee;
    uint256 public immutable timeoutSeconds;

    mapping(bytes32 escrowId => Escrow) public escrows;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant VOUCHER_TYPEHASH = keccak256("Voucher(bytes32 escrowId,uint256 cumulativeAmount)");

    event Deposited(bytes32 indexed escrowId, address indexed traveler, address signer, uint256 amount);
    event ToppedUp(bytes32 indexed escrowId, uint256 added, uint256 deposit);
    event Closed(bytes32 indexed escrowId, address indexed traveler, uint256 paid, uint256 refunded);
    event Refunded(bytes32 indexed escrowId, address indexed traveler, uint256 amount);

    constructor(address usdc_, address payee_, uint256 timeoutSeconds_) {
        if (usdc_ == address(0) || payee_ == address(0)) revert ZeroAddress();
        if (timeoutSeconds_ == 0) revert ZeroAmount();
        if (_decimalsOf(usdc_) != usdcDecimals) revert UnexpectedDecimals();

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

    /// @notice Open the channel: pull `amount` USDC from the traveler and
    /// register the session key that will sign vouchers.
    function deposit(bytes32 escrowId, uint256 amount, address signer) external {
        if (amount == 0) revert ZeroAmount();
        if (signer == address(0)) revert ZeroAddress();
        Escrow storage escrow = escrows[escrowId];
        if (escrow.traveler != address(0)) revert EscrowExists();

        escrow.traveler = msg.sender;
        escrow.signer = signer;
        escrow.openedAt = uint64(block.timestamp);
        escrow.deposit = amount;
        _pull(msg.sender, amount);

        emit Deposited(escrowId, msg.sender, signer, amount);
    }

    /// @notice Add USDC to an open channel. Only the traveler, only before close.
    function topUp(bytes32 escrowId, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        Escrow storage escrow = escrows[escrowId];
        if (escrow.traveler == address(0)) revert EscrowMissing();
        if (escrow.settled) revert AlreadySettled();
        if (msg.sender != escrow.traveler) revert NotTraveler();

        escrow.deposit += amount;
        _pull(msg.sender, amount);
        emit ToppedUp(escrowId, amount, escrow.deposit);
    }

    /// @notice Settle the channel once. AstroAm is paid `settleAmount` (what was
    /// used), which may not exceed `voucherAmount`, the running total the
    /// traveler's session key (or the traveler) signed. The rest is refunded.
    /// With `settleAmount == 0` no voucher is needed: everything is refunded.
    function close(bytes32 escrowId, uint256 voucherAmount, bytes calldata signature, uint256 settleAmount) external {
        if (msg.sender != payee) revert NotPayee();
        Escrow storage escrow = escrows[escrowId];
        address traveler = escrow.traveler;
        if (traveler == address(0)) revert EscrowMissing();
        if (escrow.settled) revert AlreadySettled();
        if (voucherAmount > escrow.deposit) revert AmountExceedsDeposit();
        if (settleAmount > voucherAmount) revert SettleExceedsVoucher();
        if (settleAmount > 0) {
            address recovered = _recover(escrowId, voucherAmount, signature);
            if (recovered == address(0) || (recovered != escrow.signer && recovered != traveler)) revert BadVoucher();
        }

        uint256 refundAmount = escrow.deposit - settleAmount;
        escrow.settled = true;

        if (settleAmount > 0) _push(payee, settleAmount);
        if (refundAmount > 0) _push(traveler, refundAmount);

        emit Closed(escrowId, traveler, settleAmount, refundAmount);
    }

    /// @notice The whole deposit back to the traveler if AstroAm never closed.
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
        if (uint256(s) > HALF_ORDER) return address(0);
        return ecrecover(voucherHash(escrowId, cumulativeAmount), v, r, s);
    }

    function _decimalsOf(address token) internal view returns (uint8) {
        (bool ok, bytes memory data) = token.staticcall(abi.encodeWithSelector(bytes4(keccak256("decimals()"))));
        if (!ok || data.length < 32) return 0;
        return abi.decode(data, (uint8));
    }

    function _pull(address from, uint256 amount) internal {
        (bool ok, bytes memory data) = usdc.call(
            abi.encodeWithSelector(bytes4(keccak256("transferFrom(address,address,uint256)")), from, address(this), amount)
        );
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _push(address to, uint256 amount) internal {
        (bool ok, bytes memory data) =
            usdc.call(abi.encodeWithSelector(bytes4(keccak256("transfer(address,uint256)")), to, amount));
        if (!ok || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}
