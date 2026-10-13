// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title AstroAmEscrow
/// @notice One-way payment channel for prepaid mobile data on Monad.
///
/// The traveler deposits Circle USDC (6 decimals) once and registers a session
/// key. While the traveler browses, the app signs EIP-712 vouchers with that
/// key for the running total it authorizes — off-chain, no gas per megabyte.
/// A voucher is the most the traveler authorizes, not a bill: the app signs
/// ahead of usage so data keeps flowing. While the channel is open AstroAm may
/// `claim` the usage it has not been paid yet, up to the voucher, so it never
/// carries much usage unpaid. It closes the channel once: it is paid what was
/// actually used (never less than what it already claimed, never more than
/// the highest voucher) and the rest goes back to the traveler in the same
/// transaction. If AstroAm never closes, `refund` returns everything not yet
/// claimed `timeoutSeconds` after the last deposit, top-up or claim.
///
/// What stays trusted: the contract cannot know how much data was used. It
/// only enforces the voucher as a ceiling, so whoever operates the channel
/// may claim or settle any amount up to it. What the traveler controls is how
/// far ahead of usage the app signs: that margin is all that is ever exposed.
///
/// AstroAm is two accounts. The `payee` is fixed at deployment and is where
/// every `claim` and `close` payment goes; it can be a cold wallet or a
/// multisig. The `operator` is the server's hot key: it sends the `claim` and
/// `close` transactions and never receives funds. The payee may send them too,
/// and replaces the operator with `setOperator`.
///
/// Each claim restarts the timeout, but only when it collects something above
/// what was already claimed: the payee can never be paid more than the
/// traveler signed, though the operator can delay the refund of the rest by
/// claiming a voucher in small parts.
///
/// A compromised operator cannot move funds anywhere except to the payee and
/// the traveler. Against AstroAm it can close a channel early with what was
/// already claimed, refunding the rest to the traveler, so the usage not yet
/// claimed is lost. Against the traveler it can at most have the payee paid
/// the full amount of a voucher the traveler signed, and delay the refund as
/// above. The payee stops it by setting a new operator.
contract AstroAmEscrow {
    error ZeroAddress();
    error ZeroAmount();
    error UnexpectedDecimals();
    error EscrowExists();
    error EscrowMissing();
    error AlreadySettled();
    error NotTraveler();
    error NotPayee();
    error NotOperator();
    error AmountExceedsDeposit();
    error SettleExceedsVoucher();
    error SettleBelowClaimed();
    error ClaimExceedsVoucher();
    error NothingToClaim();
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
        // Appended so the `escrows` getter keeps the first five fields in place.
        /// Running total already paid to the payee through `claim`.
        uint256 claimed;
        /// Last deposit, top-up or claim: the refund timeout counts from here.
        uint64 lastActivityAt;
    }

    uint8 public constant usdcDecimals = 6;
    /// secp256k1n / 2: signatures with a higher `s` are malleable (EIP-2).
    uint256 private constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;

    address public immutable usdc;
    /// Receives every `claim` and `close` payment. Never changes.
    address public immutable payee;
    uint256 public immutable timeoutSeconds;
    /// Hot key that sends `claim` and `close`. The payee replaces it with `setOperator`.
    address public operator;

    mapping(bytes32 escrowId => Escrow) public escrows;

    bytes32 public immutable DOMAIN_SEPARATOR;
    bytes32 public constant VOUCHER_TYPEHASH = keccak256("Voucher(bytes32 escrowId,uint256 cumulativeAmount)");

    event Deposited(bytes32 indexed escrowId, address indexed traveler, address signer, uint256 amount);
    event ToppedUp(bytes32 indexed escrowId, uint256 added, uint256 deposit);
    event Claimed(bytes32 indexed escrowId, uint256 amount, uint256 totalClaimed);
    /// `paid` is the total the payee received for this escrow, earlier claims
    /// included, so `paid + refunded` is always the deposit.
    event Closed(bytes32 indexed escrowId, address indexed traveler, uint256 paid, uint256 refunded);
    event Refunded(bytes32 indexed escrowId, address indexed traveler, uint256 amount);
    event OperatorChanged(address indexed previous, address indexed current);

    constructor(address usdc_, address payee_, address operator_, uint256 timeoutSeconds_) {
        if (usdc_ == address(0) || payee_ == address(0) || operator_ == address(0)) revert ZeroAddress();
        if (timeoutSeconds_ == 0) revert ZeroAmount();
        if (_decimalsOf(usdc_) != usdcDecimals) revert UnexpectedDecimals();

        usdc = usdc_;
        payee = payee_;
        operator = operator_;
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

    /// @notice Replace the operator. Only the payee: a stolen operator key is
    /// retired without touching any open channel.
    function setOperator(address operator_) external {
        if (msg.sender != payee) revert NotPayee();
        if (operator_ == address(0)) revert ZeroAddress();
        address previous = operator;
        operator = operator_;
        emit OperatorChanged(previous, operator_);
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
        escrow.lastActivityAt = uint64(block.timestamp);
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
        escrow.lastActivityAt = uint64(block.timestamp);
        _pull(msg.sender, amount);
        emit ToppedUp(escrowId, amount, escrow.deposit);
    }

    /// @notice Collect usage and keep the channel open. `voucherAmount` is the
    /// running total the traveler's session key (or the traveler) signed: the
    /// most that may be collected. `claimTotal` is the running total the payee
    /// will have been paid after this call (what was used so far): above what
    /// was already claimed and never above the voucher. The payee is paid the
    /// difference, and the rest of the voucher stays claimable with the same
    /// signature. Only the operator or the payee; the payee is paid, whoever
    /// calls. Restarts the refund timeout.
    ///
    /// The contract cannot check `claimTotal` against real usage: the voucher
    /// is the only bound it enforces.
    function claim(bytes32 escrowId, uint256 voucherAmount, bytes calldata signature, uint256 claimTotal) external {
        _checkOperator();
        Escrow storage escrow = escrows[escrowId];
        if (escrow.traveler == address(0)) revert EscrowMissing();
        if (escrow.settled) revert AlreadySettled();
        _checkVoucher(escrow, escrowId, voucherAmount, signature);
        if (claimTotal > voucherAmount) revert ClaimExceedsVoucher();
        uint256 claimed = escrow.claimed;
        if (claimTotal <= claimed) revert NothingToClaim();

        uint256 amount = claimTotal - claimed;
        escrow.claimed = claimTotal;
        escrow.lastActivityAt = uint64(block.timestamp);
        _push(payee, amount);

        emit Claimed(escrowId, amount, claimTotal);
    }

    /// @notice Settle the channel once. AstroAm is paid `settleAmount` in total
    /// (what was used, earlier claims included): never less than what it
    /// already claimed and never more than `voucherAmount`, the running total
    /// the traveler's session key (or the traveler) signed. The rest is
    /// refunded. With `settleAmount` equal to what was already claimed no new
    /// voucher is needed: everything else is refunded. Only the operator or
    /// the payee; the payee is paid, whoever calls.
    function close(bytes32 escrowId, uint256 voucherAmount, bytes calldata signature, uint256 settleAmount) external {
        _checkOperator();
        Escrow storage escrow = escrows[escrowId];
        address traveler = escrow.traveler;
        if (traveler == address(0)) revert EscrowMissing();
        if (escrow.settled) revert AlreadySettled();
        if (voucherAmount > escrow.deposit) revert AmountExceedsDeposit();
        if (settleAmount > voucherAmount) revert SettleExceedsVoucher();
        uint256 claimed = escrow.claimed;
        if (settleAmount < claimed) revert SettleBelowClaimed();
        if (settleAmount > claimed) _checkVoucher(escrow, escrowId, voucherAmount, signature);

        uint256 payAmount = settleAmount - claimed;
        uint256 refundAmount = escrow.deposit - settleAmount;
        escrow.settled = true;

        if (payAmount > 0) _push(payee, payAmount);
        if (refundAmount > 0) _push(traveler, refundAmount);

        emit Closed(escrowId, traveler, settleAmount, refundAmount);
    }

    /// @notice Everything not claimed back to the traveler if AstroAm never
    /// closed, `timeoutSeconds` after the last deposit, top-up or claim.
    function refund(bytes32 escrowId) external {
        Escrow storage escrow = escrows[escrowId];
        address traveler = escrow.traveler;
        if (traveler == address(0)) revert EscrowMissing();
        if (escrow.settled) revert AlreadySettled();
        if (block.timestamp < uint256(escrow.lastActivityAt) + timeoutSeconds) revert TimeoutNotReached();

        uint256 amount = escrow.deposit - escrow.claimed;
        escrow.settled = true;
        if (amount > 0) _push(traveler, amount);
        emit Refunded(escrowId, traveler, amount);
    }

    function voucherHash(bytes32 escrowId, uint256 cumulativeAmount) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(VOUCHER_TYPEHASH, escrowId, cumulativeAmount));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    /// Reverts unless the caller may send `claim` and `close`.
    function _checkOperator() internal view {
        if (msg.sender != operator && msg.sender != payee) revert NotOperator();
    }

    /// Reverts unless the session key or the traveler signed `voucherAmount`
    /// and the deposit covers it.
    function _checkVoucher(Escrow storage escrow, bytes32 escrowId, uint256 voucherAmount, bytes calldata signature)
        internal
        view
    {
        if (voucherAmount > escrow.deposit) revert AmountExceedsDeposit();
        address recovered = _recover(escrowId, voucherAmount, signature);
        if (recovered == address(0) || (recovered != escrow.signer && recovered != escrow.traveler)) revert BadVoucher();
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
