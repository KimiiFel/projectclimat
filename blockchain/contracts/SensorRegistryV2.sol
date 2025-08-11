// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/access/AccessControl.sol";

contract SensorRegistryV2 is AccessControl {
    bytes32 public constant GATEWAY_ROLE = keccak256("GATEWAY_ROLE");
    enum SensorType { DHT22, BH1750, RainCap }

    struct Reading {
        bytes32 dataHash;
        uint64  deviceTs;
        uint64  blockTs;
        uint8   sensorMask;
        bytes16 deviceId;
        address submitter;
        uint32  seq;
    }

    mapping(bytes32 => Reading) public readings;
    mapping(bytes16 => uint32) public lastSeqByDevice;

    event ReadingStored(
        bytes32 indexed dataHash,
        bytes16 indexed deviceId,
        uint32  indexed seq,
        uint64  deviceTs,
        uint64  blockTs,
        uint8   sensorMask,
        address submitter
    );

    constructor(address admin, address gateway) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(GATEWAY_ROLE, gateway);
    }

    function storeReading(bytes16 deviceId, bytes32 dataHash, uint64 deviceTs, uint8 sensorMask)
        external onlyRole(GATEWAY_ROLE)
    {
        require(readings[dataHash].blockTs == 0, "Already stored");
        uint32 nextSeq = lastSeqByDevice[deviceId] + 1;
        lastSeqByDevice[deviceId] = nextSeq;

        readings[dataHash] = Reading({
            dataHash: dataHash,
            deviceTs: deviceTs,
            blockTs: uint64(block.timestamp),
            sensorMask: sensorMask,
            deviceId: deviceId,
            submitter: msg.sender,
            seq: nextSeq
        });

        emit ReadingStored(dataHash, deviceId, nextSeq, deviceTs, uint64(block.timestamp), sensorMask, msg.sender);
    }

    function storeBatch(bytes16 deviceId, bytes32[] calldata hs, uint64[] calldata ts, uint8[] calldata masks)
        external onlyRole(GATEWAY_ROLE)
    {
        uint256 n = hs.length; require(ts.length==n && masks.length==n, "Len mismatch");
        for (uint256 i=0;i<n;i++){
            require(readings[hs[i]].blockTs==0, "Duplicate hash");
            uint32 nextSeq = lastSeqByDevice[deviceId] + 1;
            lastSeqByDevice[deviceId] = nextSeq;

            readings[hs[i]] = Reading(hs[i], ts[i], uint64(block.timestamp), masks[i], deviceId, msg.sender, nextSeq);
            emit ReadingStored(hs[i], deviceId, nextSeq, ts[i], uint64(block.timestamp), masks[i], msg.sender);
        }
    }
}
