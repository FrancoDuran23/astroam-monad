// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {AstroAmEscrow} from "../src/AstroAmEscrow.sol";

/// Minimal cheat-code surface so the suite does not depend on forge-std.
interface Vm {
    function prank(address) external;
    function startPrank(address) external;
    function stopPrank() external;
    function addr(uint256) external returns (address);
    function sign(uint256, bytes32) external returns (uint8, bytes32, bytes32);
    function warp(uint256) external;
}

/// 6-decimal stand-in for Circle USDC. A 7-decimal token must not deploy.
contract MockUsdc {
    string public name = "USDC";
    string public symbol = "USDC";
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
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract AstroAmEscrowTest {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 internal constant TRAVELER_KEY = 0xA11CE;
    uint256 internal constant TIMEOUT = 7 days;
    bytes32 internal constant ESCROW_ID = keccak256("mission-demo");

    MockUsdc internal usdc;
    AstroAmEscrow internal escrow;
    address internal traveler;
    address internal payee = address(0xB0B);

    function setUp() public {
        traveler = vm.addr(TRAVELER_KEY);
        usdc = new MockUsdc(6);
        escrow = new AstroAmEscrow(address(usdc), payee, TIMEOUT);
        usdc.mint(traveler, 1_000_000_000);
    }

    function test_depositPullsSixDecimalUsdc() public {
        uint256 amount = 5_000_000; // 5 USDC, not 50_000_000 (the 7-decimal figure)
        _approveAndDeposit(amount);

        (address recorded, uint96 openedAt, uint256 deposit, bool settled) = escrow.escrows(ESCROW_ID);
        require(recorded == traveler, "traveler");
        require(openedAt != 0, "opened");
        require(deposit == amount, "deposit");
        require(!settled, "settled");
        require(usdc.balanceOf(address(escrow)) == amount, "escrow balance");
        require(usdc.balanceOf(traveler) == 1_000_000_000 - amount, "traveler balance");
    }

    function test_closePaysUsedAndRefundsRest() public {
        uint256 depositAmount = 5_000_000; // 5.0 USDC
        uint256 used = 500_000; // 0.5 USDC at 6 decimals
        _approveAndDeposit(depositAmount);

        bytes memory signature = _sign(used);
        vm.prank(payee);
        escrow.close(ESCROW_ID, used, signature);

        require(usdc.balanceOf(payee) == used, "payee paid");
        require(usdc.balanceOf(traveler) == 1_000_000_000 - used, "traveler refunded the rest");
        require(usdc.balanceOf(address(escrow)) == 0, "escrow empty");

        (, , , bool settled) = escrow.escrows(ESCROW_ID);
        require(settled, "settled");
    }

    function test_closeRejectsASecondSettlement() public {
        _approveAndDeposit(1_000_000);
        escrow.close(ESCROW_ID, 100_000, _sign(100_000));

        (bool ok, bytes memory reason) = address(escrow).call(
            abi.encodeWithSelector(escrow.close.selector, ESCROW_ID, uint256(100_000), _sign(100_000))
        );
        require(!ok, "second close should revert");
        require(_selector(reason) == AstroAmEscrow.AlreadySettled.selector, "AlreadySettled");
    }

    function test_naiveSevenDecimalAmountOverchargesAndReverts() public {
        // 1 USDC deposited at 6 decimals. 0.2 USDC of usage is 200_000.
        // The same 0.2 USDC in Stellar raw units (1e-7) is 2_000_000, which
        // is larger than the deposit and must not be payable.
        _approveAndDeposit(1_000_000);
        uint256 stellarRaw = 2_000_000;

        (bool ok, bytes memory reason) = address(escrow).call(
            abi.encodeWithSelector(escrow.close.selector, ESCROW_ID, stellarRaw, _sign(stellarRaw))
        );
        require(!ok, "7-decimal amount should revert");
        require(_selector(reason) == AstroAmEscrow.AmountExceedsDeposit.selector, "AmountExceedsDeposit");

        escrow.close(ESCROW_ID, 200_000, _sign(200_000));
        require(usdc.balanceOf(payee) == 200_000, "six decimal charge");
        require(usdc.balanceOf(traveler) == 1_000_000_000 - 200_000, "refund keeps 0.8 USDC");
    }

    function test_refundBeforeTimeoutReverts() public {
        _approveAndDeposit(5_000_000);
        (bool ok, bytes memory reason) = address(escrow).call(abi.encodeWithSelector(escrow.refund.selector, ESCROW_ID));
        require(!ok, "early refund should revert");
        require(_selector(reason) == AstroAmEscrow.TimeoutNotReached.selector, "TimeoutNotReached");
        require(usdc.balanceOf(address(escrow)) == 5_000_000, "funds stay escrowed");
    }

    function test_timeoutRefundReturnsFullDeposit() public {
        uint256 amount = 5_000_000;
        _approveAndDeposit(amount);

        vm.warp(block.timestamp + TIMEOUT);
        address anyone = address(0xCAFE);
        vm.prank(anyone);
        escrow.refund(ESCROW_ID);

        require(usdc.balanceOf(traveler) == 1_000_000_000, "full refund to traveler");
        require(usdc.balanceOf(payee) == 0, "payee got nothing");
        require(usdc.balanceOf(address(escrow)) == 0, "escrow empty");
        require(usdc.balanceOf(anyone) == 0, "caller is not paid");
    }

    function test_timeoutRefundAfterCloseReverts() public {
        _approveAndDeposit(1_000_000);
        escrow.close(ESCROW_ID, 0, _sign(0));
        vm.warp(block.timestamp + TIMEOUT);

        (bool ok, bytes memory reason) = address(escrow).call(abi.encodeWithSelector(escrow.refund.selector, ESCROW_ID));
        require(!ok, "refund after close should revert");
        require(_selector(reason) == AstroAmEscrow.AlreadySettled.selector, "AlreadySettled");
    }

    function test_rejectsTokenThatIsNotSixDecimals() public {
        MockUsdc stellarScale = new MockUsdc(7);
        (bool ok, bytes memory reason) = address(new AstroAmEscrowDeployer()).call(
            abi.encodeWithSelector(AstroAmEscrowDeployer.deploy.selector, address(stellarScale), payee, TIMEOUT)
        );
        require(!ok, "7 decimal token should not deploy");
        require(_selector(reason) == AstroAmEscrow.UnexpectedDecimals.selector, "UnexpectedDecimals");
    }

    function _approveAndDeposit(uint256 amount) internal {
        vm.startPrank(traveler);
        usdc.approve(address(escrow), amount);
        escrow.deposit(ESCROW_ID, amount);
        vm.stopPrank();
    }

    function _sign(uint256 cumulativeAmount) internal returns (bytes memory) {
        bytes32 digest = escrow.voucherHash(ESCROW_ID, cumulativeAmount);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(TRAVELER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _selector(bytes memory reason) internal pure returns (bytes4 sel) {
        if (reason.length < 4) return bytes4(0);
        assembly {
            sel := mload(add(reason, 32))
        }
    }
}

/// External deployer so a reverting constructor can be caught with a call.
contract AstroAmEscrowDeployer {
    function deploy(address usdc, address payee, uint256 timeout) external returns (AstroAmEscrow) {
        return new AstroAmEscrow(usdc, payee, timeout);
    }
}
