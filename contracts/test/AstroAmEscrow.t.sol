// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AstroAmEscrow} from "../src/AstroAmEscrow.sol";

/// Minimal cheat-code surface so the suite does not depend on forge-std.
interface Vm {
    function prank(address) external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function warp(uint256) external;
    function expectRevert(bytes4) external;
    function expectEmit(bool, bool, bool, bool, address) external;
    function chainId(uint256) external;
}

/// 6-decimal stand-in for Circle USDC.
contract MockUsdc {
    uint8 public immutable decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(uint8 decimals_) {
        decimals = decimals_;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AstroAmEscrowTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TRAVELER_KEY = 0xA11CE;
    uint256 internal constant SESSION_KEY = 0x5E5510;
    uint256 internal constant STRANGER_KEY = 0xBAD;
    uint256 internal constant TIMEOUT = 30 days;
    uint256 internal constant DEPOSIT = 5_000_000; // 5 USDC, 6 decimals
    bytes32 internal constant ESCROW_ID = keccak256("astroam-escrow:mis_demo");
    uint256 internal constant HALF_ORDER = 0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0;
    uint256 internal constant ORDER = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141;

    MockUsdc internal usdc;
    AstroAmEscrow internal escrow;
    address internal traveler;
    address internal session;
    address internal stranger;
    // Two different accounts: the payee is paid, the operator only sends.
    address internal payee = address(0xB0B);
    address internal operator = address(0x0931);
    address internal nextOperator = address(0x0932);

    event OperatorChanged(address indexed previous, address indexed current);
    event Claimed(bytes32 indexed escrowId, uint256 amount, uint256 totalClaimed);

    function setUp() public {
        traveler = vm.addr(TRAVELER_KEY);
        session = vm.addr(SESSION_KEY);
        stranger = vm.addr(STRANGER_KEY);
        usdc = new MockUsdc(6);
        escrow = new AstroAmEscrow(address(usdc), payee, operator, TIMEOUT);
        usdc.mint(traveler, 100_000_000);
    }

    function _open() internal {
        vm.prank(traveler);
        usdc.approve(address(escrow), DEPOSIT);
        vm.prank(traveler);
        escrow.deposit(ESCROW_ID, DEPOSIT, session);
    }

    function _sign(uint256 key, uint256 amount) internal returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, escrow.voucherHash(ESCROW_ID, amount));
        return abi.encodePacked(r, s, v);
    }

    function _claim(uint256 key, uint256 amount) internal {
        bytes memory sig = _sign(key, amount);
        vm.prank(operator);
        escrow.claim(ESCROW_ID, amount, sig, amount);
    }

    function _claimed() internal view returns (uint256 claimed) {
        (,,,,, claimed,) = escrow.escrows(ESCROW_ID);
    }

    function _settled() internal view returns (bool settled) {
        (,, settled,,,,) = escrow.escrows(ESCROW_ID);
    }

    function test_depositRecordsTravelerSessionKeyAndAmount() public {
        _open();
        (address t, uint64 openedAt, bool settled, address signer, uint256 dep, uint256 claimed, uint64 lastActivityAt) =
            escrow.escrows(ESCROW_ID);
        require(t == traveler && signer == session && dep == DEPOSIT && !settled && openedAt != 0, "escrow");
        require(claimed == 0 && lastActivityAt == openedAt, "nothing claimed yet");
        require(usdc.balanceOf(address(escrow)) == DEPOSIT, "pulled");
    }

    function test_closePaysUsageAndRefundsTheRest() public {
        _open();
        // The app authorized 2.0 USDC ahead; only 1.875 USDC was used.
        bytes memory sig = _sign(SESSION_KEY, 2_000_000);
        vm.prank(operator);
        escrow.close(ESCROW_ID, 2_000_000, sig, 1_875_000);
        require(usdc.balanceOf(payee) == 1_875_000, "payee paid usage");
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_875_000, "rest refunded");
        require(usdc.balanceOf(address(escrow)) == 0, "escrow empty");
    }

    function test_travelerMaySignTheVoucherDirectly() public {
        _open();
        bytes memory sig = _sign(TRAVELER_KEY, 1_000_000);
        vm.prank(operator);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
        require(usdc.balanceOf(payee) == 1_000_000, "paid");
    }

    function test_closeWithoutUsageRefundsEverythingWithoutAVoucher() public {
        _open();
        vm.prank(operator);
        escrow.close(ESCROW_ID, 0, "", 0);
        require(usdc.balanceOf(traveler) == 100_000_000, "full refund");
    }

    function test_cannotSettleMoreThanTheVoucher() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.SettleExceedsVoucher.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_001);
    }

    function test_voucherCannotExceedTheDeposit() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, DEPOSIT + 1);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.AmountExceedsDeposit.selector);
        escrow.close(ESCROW_ID, DEPOSIT + 1, sig, DEPOSIT);
    }

    function test_travelerCannotClose() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(traveler);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    function test_voucherFromAnotherKeyIsRejected() public {
        _open();
        bytes memory sig = _sign(STRANGER_KEY, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    function test_voucherForADifferentAmountIsRejected() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.close(ESCROW_ID, 2_000_000, sig, 2_000_000);
    }

    function test_malleableSignatureIsRejected() public {
        _open();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SESSION_KEY, escrow.voucherHash(ESCROW_ID, 1_000_000));
        require(uint256(s) <= HALF_ORDER, "low-s from vm.sign");
        // Same signature, flipped to its high-s twin: valid for ecrecover, refused here.
        bytes memory twin = abi.encodePacked(r, bytes32(ORDER - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.close(ESCROW_ID, 1_000_000, twin, 1_000_000);
    }

    function test_closesOnlyOnce() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(operator);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.AlreadySettled.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    function test_topUpAddsToTheSameChannel() public {
        _open();
        vm.prank(traveler);
        usdc.approve(address(escrow), 2_000_000);
        vm.prank(traveler);
        escrow.topUp(ESCROW_ID, 2_000_000);
        (,,,, uint256 dep,,) = escrow.escrows(ESCROW_ID);
        require(dep == DEPOSIT + 2_000_000, "topped up");
    }

    function test_onlyTheTravelerTopsUp() public {
        _open();
        vm.prank(payee);
        vm.expectRevert(AstroAmEscrow.NotTraveler.selector);
        escrow.topUp(ESCROW_ID, 1);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NotTraveler.selector);
        escrow.topUp(ESCROW_ID, 1);
    }

    function test_escrowIdCannotBeReused() public {
        _open();
        vm.prank(traveler);
        usdc.approve(address(escrow), DEPOSIT);
        vm.prank(traveler);
        vm.expectRevert(AstroAmEscrow.EscrowExists.selector);
        escrow.deposit(ESCROW_ID, DEPOSIT, session);
    }

    function test_refundOnlyAfterTimeout() public {
        _open();
        vm.expectRevert(AstroAmEscrow.TimeoutNotReached.selector);
        escrow.refund(ESCROW_ID);

        vm.warp(block.timestamp + TIMEOUT);
        escrow.refund(ESCROW_ID);
        require(usdc.balanceOf(traveler) == 100_000_000, "full deposit back");
    }

    // --- claim ------------------------------------------------------------

    function test_claimPaysTheVoucherAndKeepsTheEscrowOpen() public {
        _open();
        _claim(SESSION_KEY, 1_000_000);
        require(usdc.balanceOf(payee) == 1_000_000, "payee paid");
        require(usdc.balanceOf(address(escrow)) == DEPOSIT - 1_000_000, "rest stays locked");
        require(_claimed() == 1_000_000 && !_settled(), "still open");

        // The traveler can still top up the same channel.
        vm.prank(traveler);
        usdc.approve(address(escrow), 1_000_000);
        vm.prank(traveler);
        escrow.topUp(ESCROW_ID, 1_000_000);
        (,,,, uint256 dep,,) = escrow.escrows(ESCROW_ID);
        require(dep == DEPOSIT + 1_000_000, "topped up after claim");
    }

    function test_successiveClaimsPayOnlyTheDifference() public {
        _open();
        _claim(SESSION_KEY, 1_000_000);
        _claim(SESSION_KEY, 2_500_000);
        require(usdc.balanceOf(payee) == 2_500_000, "paid the running total once");
        require(_claimed() == 2_500_000, "claimed");
        require(usdc.balanceOf(address(escrow)) == DEPOSIT - 2_500_000, "escrow holds the rest");
    }

    function test_claimAtOrBelowClaimedReverts() public {
        _open();
        _claim(SESSION_KEY, 2_000_000);

        bytes memory same = _sign(SESSION_KEY, 2_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NothingToClaim.selector);
        escrow.claim(ESCROW_ID, 2_000_000, same, 2_000_000);

        bytes memory lower = _sign(SESSION_KEY, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NothingToClaim.selector);
        escrow.claim(ESCROW_ID, 1_000_000, lower, 1_000_000);
    }

    function test_claimOfZeroReverts() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 0);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NothingToClaim.selector);
        escrow.claim(ESCROW_ID, 0, sig, 0);
    }

    // --- claim below the voucher: the voucher is a ceiling, not a bill ------

    function test_claimBelowTheVoucherPaysTheDifferenceAndLeavesTheRestClaimable() public {
        _open();
        // The app signed 4 USDC ahead; 1 USDC was used so far.
        bytes memory sig = _sign(SESSION_KEY, 4_000_000);
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Claimed(ESCROW_ID, 1_000_000, 1_000_000);
        vm.prank(operator);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 1_000_000);
        require(usdc.balanceOf(payee) == 1_000_000, "payee paid the usage, not the voucher");
        require(_claimed() == 1_000_000 && !_settled(), "claimed is the usage");
        require(usdc.balanceOf(address(escrow)) == DEPOSIT - 1_000_000, "rest stays locked");

        // The same voucher still covers later usage, up to its amount.
        vm.expectEmit(true, false, false, true, address(escrow));
        emit Claimed(ESCROW_ID, 1_500_000, 2_500_000);
        vm.prank(operator);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 2_500_000);
        require(usdc.balanceOf(payee) == 2_500_000 && _claimed() == 2_500_000, "second part");
        vm.prank(operator);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 4_000_000);
        require(usdc.balanceOf(payee) == 4_000_000 && _claimed() == 4_000_000, "up to the voucher");
        require(usdc.balanceOf(address(escrow)) == DEPOSIT - 4_000_000, "escrow holds the rest");
    }

    function test_claimTotalAboveTheVoucherReverts() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 2_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.ClaimExceedsVoucher.selector);
        escrow.claim(ESCROW_ID, 2_000_000, sig, 2_000_001);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.ClaimExceedsVoucher.selector);
        escrow.claim(ESCROW_ID, 2_000_000, sig, DEPOSIT);
        require(usdc.balanceOf(payee) == 0 && _claimed() == 0, "nothing moved");
    }

    function test_claimTotalNotAboveClaimedReverts() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 4_000_000);
        vm.prank(operator);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 1_000_000);

        // Although the voucher has 3 USDC left, a total at or below what was claimed pays nothing.
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NothingToClaim.selector);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NothingToClaim.selector);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 999_999);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NothingToClaim.selector);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 0);
        require(usdc.balanceOf(payee) == 1_000_000 && _claimed() == 1_000_000, "nothing more moved");
    }

    function test_partialClaimStillChecksTheVoucher() public {
        _open();
        bytes memory stranger = _sign(STRANGER_KEY, 4_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.claim(ESCROW_ID, 4_000_000, stranger, 1);

        bytes memory tooMuch = _sign(SESSION_KEY, DEPOSIT + 1);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.AmountExceedsDeposit.selector);
        escrow.claim(ESCROW_ID, DEPOSIT + 1, tooMuch, 1);
    }

    function test_twoPartialClaimsOnOneVoucherThenCloseAtAHigherUsage() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 4_000_000);
        vm.prank(operator);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 1_000_000);
        vm.prank(operator);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 2_000_000);
        require(usdc.balanceOf(payee) == 2_000_000, "two claims, 2 USDC in all");

        // The trip ends with 3 USDC used: the same voucher covers the close.
        vm.prank(operator);
        escrow.close(ESCROW_ID, 4_000_000, sig, 3_000_000);
        require(usdc.balanceOf(payee) == 3_000_000, "payee got the usage in total");
        require(usdc.balanceOf(traveler) == 100_000_000 - 3_000_000, "everything not used refunded");
        require(usdc.balanceOf(address(escrow)) == 0 && _settled(), "settled and empty");
    }

    function test_closeRightAfterAPartialClaimAtTheSameAmountNeedsNoNewVoucher() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 4_000_000);
        vm.prank(operator);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 1_500_000);

        // No more usage: close at what was claimed, with no signature at all.
        vm.prank(operator);
        escrow.close(ESCROW_ID, 1_500_000, "", 1_500_000);
        require(usdc.balanceOf(payee) == 1_500_000, "nothing more paid");
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_500_000, "the unused part of the voucher is refunded too");
        require(usdc.balanceOf(address(escrow)) == 0 && _settled(), "settled and empty");
    }

    function test_refundAfterAPartialClaimReturnsEverythingNotClaimed() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 4_000_000);
        vm.prank(operator);
        escrow.claim(ESCROW_ID, 4_000_000, sig, 1_000_000);
        vm.warp(block.timestamp + TIMEOUT);
        escrow.refund(ESCROW_ID);
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_000_000, "the unclaimed 4 USDC back, signed or not");
        require(usdc.balanceOf(payee) == 1_000_000, "claim kept");
    }

    function test_travelerCannotClaim() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(traveler);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.claim(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    function test_claimRejectsVoucherFromAnotherKey() public {
        _open();
        bytes memory sig = _sign(STRANGER_KEY, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.claim(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    function test_claimRejectsVoucherForADifferentAmount() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.claim(ESCROW_ID, 2_000_000, sig, 2_000_000);
    }

    function test_claimRejectsMalleableSignature() public {
        _open();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SESSION_KEY, escrow.voucherHash(ESCROW_ID, 1_000_000));
        bytes memory twin = abi.encodePacked(r, bytes32(ORDER - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.claim(ESCROW_ID, 1_000_000, twin, 1_000_000);
    }

    function test_claimCannotExceedTheDeposit() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, DEPOSIT + 1);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.AmountExceedsDeposit.selector);
        escrow.claim(ESCROW_ID, DEPOSIT + 1, sig, DEPOSIT + 1);
    }

    function test_travelerSignedVoucherCanBeClaimed() public {
        _open();
        _claim(TRAVELER_KEY, 1_500_000);
        require(usdc.balanceOf(payee) == 1_500_000, "paid");
    }

    function test_claimOnMissingEscrowReverts() public {
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.EscrowMissing.selector);
        escrow.claim(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    function test_claimAfterCloseReverts() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(operator);
        escrow.close(ESCROW_ID, 1_000_000, sig, 500_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.AlreadySettled.selector);
        escrow.claim(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    // --- close and refund after claims -----------------------------------

    function test_closeAfterClaimsPaysOnlyTheRest() public {
        _open();
        _claim(SESSION_KEY, 1_000_000);
        // Authorized 2.0 USDC in total; 1.875 USDC was used.
        bytes memory sig = _sign(SESSION_KEY, 2_000_000);
        vm.prank(operator);
        escrow.close(ESCROW_ID, 2_000_000, sig, 1_875_000);
        require(usdc.balanceOf(payee) == 1_875_000, "payee got usage in total");
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_875_000, "rest refunded");
        require(usdc.balanceOf(address(escrow)) == 0, "escrow empty");
        require(_settled(), "settled");
    }

    function test_closeBelowClaimedReverts() public {
        _open();
        _claim(SESSION_KEY, 2_000_000);
        bytes memory sig = _sign(SESSION_KEY, 2_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.SettleBelowClaimed.selector);
        escrow.close(ESCROW_ID, 2_000_000, sig, 1_999_999);

        // The no-usage close no longer works once something was claimed.
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.SettleBelowClaimed.selector);
        escrow.close(ESCROW_ID, 0, "", 0);
    }

    function test_closeAtClaimedNeedsNoNewVoucher() public {
        _open();
        _claim(SESSION_KEY, 2_000_000);
        vm.prank(operator);
        escrow.close(ESCROW_ID, 2_000_000, "", 2_000_000);
        require(usdc.balanceOf(payee) == 2_000_000, "nothing more paid");
        require(usdc.balanceOf(traveler) == 100_000_000 - 2_000_000, "rest refunded");
        require(usdc.balanceOf(address(escrow)) == 0, "escrow empty");
    }

    function test_closeAboveClaimedStillNeedsAVoucher() public {
        _open();
        _claim(SESSION_KEY, 1_000_000);
        bytes memory sig = _sign(STRANGER_KEY, 2_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.close(ESCROW_ID, 2_000_000, sig, 2_000_000);
    }

    function test_refundAfterClaimReturnsOnlyUnclaimed() public {
        _open();
        _claim(SESSION_KEY, 1_250_000);
        vm.warp(block.timestamp + TIMEOUT);
        escrow.refund(ESCROW_ID);
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_250_000, "only the unclaimed part back");
        require(usdc.balanceOf(payee) == 1_250_000, "claim kept");
        require(usdc.balanceOf(address(escrow)) == 0, "escrow empty");
    }

    function test_refundAfterFullClaimSettlesWithNothingToReturn() public {
        _open();
        _claim(SESSION_KEY, DEPOSIT);
        vm.warp(block.timestamp + TIMEOUT);
        escrow.refund(ESCROW_ID);
        require(_settled(), "settled");
        require(usdc.balanceOf(traveler) == 100_000_000 - DEPOSIT, "nothing back");
    }

    function test_claimRestartsTheTimeout() public {
        _open();
        uint256 opened = block.timestamp;
        vm.warp(opened + TIMEOUT - 1 days);
        _claim(SESSION_KEY, 1_000_000);
        uint256 claimedAt = block.timestamp;

        vm.warp(opened + TIMEOUT + 1 days);
        vm.expectRevert(AstroAmEscrow.TimeoutNotReached.selector);
        escrow.refund(ESCROW_ID);

        vm.warp(claimedAt + TIMEOUT);
        escrow.refund(ESCROW_ID);
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_000_000, "unclaimed back");
    }

    function test_topUpRestartsTheTimeout() public {
        _open();
        uint256 opened = block.timestamp;
        vm.warp(opened + TIMEOUT - 1 days);
        vm.prank(traveler);
        usdc.approve(address(escrow), 1_000_000);
        vm.prank(traveler);
        escrow.topUp(ESCROW_ID, 1_000_000);
        uint256 toppedUpAt = block.timestamp;

        vm.warp(opened + TIMEOUT + 1 days);
        vm.expectRevert(AstroAmEscrow.TimeoutNotReached.selector);
        escrow.refund(ESCROW_ID);

        vm.warp(toppedUpAt + TIMEOUT);
        escrow.refund(ESCROW_ID);
        require(usdc.balanceOf(traveler) == 100_000_000, "everything back");
    }

    function test_refundAfterCloseReverts() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(operator);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);

        vm.warp(block.timestamp + TIMEOUT);
        vm.expectRevert(AstroAmEscrow.AlreadySettled.selector);
        escrow.refund(ESCROW_ID);
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_000_000, "refunded once, by close");
        require(usdc.balanceOf(payee) == 1_000_000, "payee keeps what was settled");
    }

    function test_claimAndCloseAfterRefundRevert() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.warp(block.timestamp + TIMEOUT);
        escrow.refund(ESCROW_ID);

        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.AlreadySettled.selector);
        escrow.claim(ESCROW_ID, 1_000_000, sig, 1_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.AlreadySettled.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
        require(usdc.balanceOf(payee) == 0, "nothing paid after the refund");
    }

    // --- operator and payee ----------------------------------------------

    function test_constructorRecordsPayeeAndOperator() public view {
        require(escrow.payee() == payee && escrow.operator() == operator, "roles");
        require(payee != operator, "two different accounts");
    }

    function test_claimByTheOperatorPaysThePayeeNotTheOperator() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(operator);
        escrow.claim(ESCROW_ID, 1_000_000, sig, 1_000_000);
        require(usdc.balanceOf(payee) == 1_000_000, "payee paid");
        require(usdc.balanceOf(operator) == 0, "operator holds nothing");
        require(usdc.balanceOf(address(escrow)) == DEPOSIT - 1_000_000, "rest stays locked");
    }

    function test_closeByTheOperatorPaysThePayeeAndRefundsTheTraveler() public {
        _open();
        _claim(SESSION_KEY, 1_000_000);
        bytes memory sig = _sign(SESSION_KEY, 2_000_000);
        vm.prank(operator);
        escrow.close(ESCROW_ID, 2_000_000, sig, 1_875_000);
        require(usdc.balanceOf(payee) == 1_875_000, "payee paid usage");
        require(usdc.balanceOf(operator) == 0, "operator holds nothing");
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_875_000, "rest refunded");
        require(usdc.balanceOf(address(escrow)) == 0, "escrow empty");
    }

    function test_payeeMayClaimAndClose() public {
        _open();
        bytes memory first = _sign(SESSION_KEY, 1_000_000);
        vm.prank(payee);
        escrow.claim(ESCROW_ID, 1_000_000, first, 1_000_000);
        require(usdc.balanceOf(payee) == 1_000_000 && _claimed() == 1_000_000, "claimed by the payee");

        bytes memory last = _sign(SESSION_KEY, 2_000_000);
        vm.prank(payee);
        escrow.close(ESCROW_ID, 2_000_000, last, 1_875_000);
        require(usdc.balanceOf(payee) == 1_875_000, "closed by the payee");
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_875_000, "rest refunded");
        require(_settled(), "settled");
    }

    function test_thirdAccountCannotClaim() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(stranger);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.claim(ESCROW_ID, 1_000_000, sig, 1_000_000);
        // Holding the session key does not make its address a caller either.
        vm.prank(session);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.claim(ESCROW_ID, 1_000_000, sig, 1_000_000);
        require(usdc.balanceOf(address(escrow)) == DEPOSIT && _claimed() == 0, "nothing moved");
    }

    function test_thirdAccountCannotClose() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(stranger);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
        // Not even the close that only refunds: the traveler waits for the timeout.
        vm.prank(stranger);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.close(ESCROW_ID, 0, "", 0);
        vm.prank(traveler);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.close(ESCROW_ID, 0, "", 0);
        require(usdc.balanceOf(address(escrow)) == DEPOSIT && !_settled(), "nothing moved");
    }

    function test_operatorClosingEarlyOnlyRefundsTheTraveler() public {
        _open();
        _claim(SESSION_KEY, 1_000_000);
        // The most a stolen operator key can do without a new voucher.
        vm.prank(operator);
        escrow.close(ESCROW_ID, 1_000_000, "", 1_000_000);
        require(usdc.balanceOf(payee) == 1_000_000, "payee keeps what was claimed");
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_000_000, "rest back to the traveler");
        require(usdc.balanceOf(operator) == 0, "operator holds nothing");
        require(usdc.balanceOf(address(escrow)) == 0, "escrow empty");
    }

    function test_onlyThePayeeSetsTheOperator() public {
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NotPayee.selector);
        escrow.setOperator(nextOperator);
        vm.prank(traveler);
        vm.expectRevert(AstroAmEscrow.NotPayee.selector);
        escrow.setOperator(nextOperator);
        vm.prank(stranger);
        vm.expectRevert(AstroAmEscrow.NotPayee.selector);
        escrow.setOperator(stranger);
        require(escrow.operator() == operator, "unchanged");
    }

    function test_setOperatorRejectsTheZeroAddress() public {
        vm.prank(payee);
        vm.expectRevert(AstroAmEscrow.ZeroAddress.selector);
        escrow.setOperator(address(0));
        require(escrow.operator() == operator, "unchanged");
    }

    function test_setOperatorEmitsOperatorChanged() public {
        vm.expectEmit(true, true, false, true, address(escrow));
        emit OperatorChanged(operator, nextOperator);
        vm.prank(payee);
        escrow.setOperator(nextOperator);
        require(escrow.operator() == nextOperator, "replaced");
        require(escrow.payee() == payee, "payee never changes");
    }

    function test_previousOperatorCanNoLongerClaimOrClose() public {
        _open();
        _claim(SESSION_KEY, 1_000_000);
        vm.prank(payee);
        escrow.setOperator(nextOperator);

        bytes memory sig = _sign(SESSION_KEY, 2_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.claim(ESCROW_ID, 2_000_000, sig, 2_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.close(ESCROW_ID, 2_000_000, sig, 2_000_000);
        vm.prank(operator);
        vm.expectRevert(AstroAmEscrow.NotOperator.selector);
        escrow.close(ESCROW_ID, 1_000_000, "", 1_000_000);
        require(_claimed() == 1_000_000 && !_settled(), "channel untouched");
    }

    function test_newOperatorClaimsAndClosesForTheSamePayee() public {
        _open();
        _claim(SESSION_KEY, 1_000_000);
        vm.prank(payee);
        escrow.setOperator(nextOperator);

        // Vouchers signed before the change stay valid: they do not name the operator.
        bytes memory sig = _sign(SESSION_KEY, 2_000_000);
        vm.prank(nextOperator);
        escrow.claim(ESCROW_ID, 2_000_000, sig, 2_000_000);
        require(usdc.balanceOf(payee) == 2_000_000, "payee paid");

        bytes memory last = _sign(SESSION_KEY, 3_000_000);
        vm.prank(nextOperator);
        escrow.close(ESCROW_ID, 3_000_000, last, 2_500_000);
        require(usdc.balanceOf(payee) == 2_500_000, "payee paid usage");
        require(usdc.balanceOf(nextOperator) == 0 && usdc.balanceOf(operator) == 0, "operators hold nothing");
        require(usdc.balanceOf(traveler) == 100_000_000 - 2_500_000, "rest refunded");
    }

    function test_payeeStillClaimsAfterReplacingTheOperator() public {
        _open();
        vm.prank(payee);
        escrow.setOperator(nextOperator);
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(payee);
        escrow.claim(ESCROW_ID, 1_000_000, sig, 1_000_000);
        require(usdc.balanceOf(payee) == 1_000_000, "paid");
    }

    // --- voucher digest ---------------------------------------------------

    function test_voucherHashMatchesTheDigestPinnedInTypeScript() public {
        // Same chain id, contract address, escrow id and amount as
        // src/shared/monad/voucher.test.ts, which pins the same digest.
        vm.chainId(10143);
        // First deployment of the first anvil account: a fixed address.
        vm.prank(0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266);
        AstroAmEscrow pinned = new AstroAmEscrow(address(usdc), payee, operator, TIMEOUT);
        require(address(pinned) == 0x5FbDB2315678afecb367f032d93F642f64180aa3, "fixed address");
        bytes32 digest = pinned.voucherHash(ESCROW_ID, 1_875_000);
        require(digest == 0x8c20e045a32f9dea7ca92ddbc40f321563bbe7d58b8da80a1017d01dfcd08904, "digest");
    }

    // --- constructor ------------------------------------------------------

    function test_zeroOperatorCannotBeUsed() public {
        vm.expectRevert(AstroAmEscrow.ZeroAddress.selector);
        new AstroAmEscrow(address(usdc), payee, address(0), TIMEOUT);
    }

    function test_zeroPayeeCannotBeUsed() public {
        vm.expectRevert(AstroAmEscrow.ZeroAddress.selector);
        new AstroAmEscrow(address(usdc), address(0), operator, TIMEOUT);
    }

    function test_sevenDecimalTokenCannotBeUsed() public {
        MockUsdc stellarStyle = new MockUsdc(7);
        vm.expectRevert(AstroAmEscrow.UnexpectedDecimals.selector);
        new AstroAmEscrow(address(stellarStyle), payee, operator, TIMEOUT);
    }
}
