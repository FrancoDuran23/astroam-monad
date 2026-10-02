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
    address internal payee = address(0xB0B);

    function setUp() public {
        traveler = vm.addr(TRAVELER_KEY);
        session = vm.addr(SESSION_KEY);
        usdc = new MockUsdc(6);
        escrow = new AstroAmEscrow(address(usdc), payee, TIMEOUT);
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

    function test_depositRecordsTravelerSessionKeyAndAmount() public {
        _open();
        (address t, uint64 openedAt, bool settled, address signer, uint256 dep) = escrow.escrows(ESCROW_ID);
        require(t == traveler && signer == session && dep == DEPOSIT && !settled && openedAt != 0, "escrow");
        require(usdc.balanceOf(address(escrow)) == DEPOSIT, "pulled");
    }

    function test_closePaysUsageAndRefundsTheRest() public {
        _open();
        // The app authorized 2.0 USDC ahead; only 1.875 USDC was used.
        bytes memory sig = _sign(SESSION_KEY, 2_000_000);
        vm.prank(payee);
        escrow.close(ESCROW_ID, 2_000_000, sig, 1_875_000);
        require(usdc.balanceOf(payee) == 1_875_000, "payee paid usage");
        require(usdc.balanceOf(traveler) == 100_000_000 - 1_875_000, "rest refunded");
        require(usdc.balanceOf(address(escrow)) == 0, "escrow empty");
    }

    function test_travelerMaySignTheVoucherDirectly() public {
        _open();
        bytes memory sig = _sign(TRAVELER_KEY, 1_000_000);
        vm.prank(payee);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
        require(usdc.balanceOf(payee) == 1_000_000, "paid");
    }

    function test_closeWithoutUsageRefundsEverythingWithoutAVoucher() public {
        _open();
        vm.prank(payee);
        escrow.close(ESCROW_ID, 0, "", 0);
        require(usdc.balanceOf(traveler) == 100_000_000, "full refund");
    }

    function test_cannotSettleMoreThanTheVoucher() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(payee);
        vm.expectRevert(AstroAmEscrow.SettleExceedsVoucher.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_001);
    }

    function test_voucherCannotExceedTheDeposit() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, DEPOSIT + 1);
        vm.prank(payee);
        vm.expectRevert(AstroAmEscrow.AmountExceedsDeposit.selector);
        escrow.close(ESCROW_ID, DEPOSIT + 1, sig, DEPOSIT);
    }

    function test_onlyThePayeeCloses() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(traveler);
        vm.expectRevert(AstroAmEscrow.NotPayee.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    function test_voucherFromAnotherKeyIsRejected() public {
        _open();
        bytes memory sig = _sign(STRANGER_KEY, 1_000_000);
        vm.prank(payee);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    function test_voucherForADifferentAmountIsRejected() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(payee);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.close(ESCROW_ID, 2_000_000, sig, 2_000_000);
    }

    function test_malleableSignatureIsRejected() public {
        _open();
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SESSION_KEY, escrow.voucherHash(ESCROW_ID, 1_000_000));
        require(uint256(s) <= HALF_ORDER, "low-s from vm.sign");
        // Same signature, flipped to its high-s twin: valid for ecrecover, refused here.
        bytes memory twin = abi.encodePacked(r, bytes32(ORDER - uint256(s)), v == 27 ? uint8(28) : uint8(27));
        vm.prank(payee);
        vm.expectRevert(AstroAmEscrow.BadVoucher.selector);
        escrow.close(ESCROW_ID, 1_000_000, twin, 1_000_000);
    }

    function test_closesOnlyOnce() public {
        _open();
        bytes memory sig = _sign(SESSION_KEY, 1_000_000);
        vm.prank(payee);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
        vm.prank(payee);
        vm.expectRevert(AstroAmEscrow.AlreadySettled.selector);
        escrow.close(ESCROW_ID, 1_000_000, sig, 1_000_000);
    }

    function test_topUpAddsToTheSameChannel() public {
        _open();
        vm.prank(traveler);
        usdc.approve(address(escrow), 2_000_000);
        vm.prank(traveler);
        escrow.topUp(ESCROW_ID, 2_000_000);
        (,,,, uint256 dep) = escrow.escrows(ESCROW_ID);
        require(dep == DEPOSIT + 2_000_000, "topped up");
    }

    function test_onlyTheTravelerTopsUp() public {
        _open();
        vm.prank(payee);
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

    function test_sevenDecimalTokenCannotBeUsed() public {
        MockUsdc stellarStyle = new MockUsdc(7);
        vm.expectRevert(AstroAmEscrow.UnexpectedDecimals.selector);
        new AstroAmEscrow(address(stellarStyle), payee, TIMEOUT);
    }
}
