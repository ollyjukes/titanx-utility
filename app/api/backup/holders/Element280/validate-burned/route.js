// ./app/api/holders/Element280/validate-burned/route.js
import { NextResponse } from 'next/server';
import config from '@/config';
import { getTransactionReceipt, log, client } from '@/app/api/utils.js';
import { parseAbiItem } from 'viem';

export async function POST(request) {
  if (process.env.DEBUG === 'true') {
    log(`[validate-burned] [DEBUG] Processing POST request for validate-burned`);
  }

  try {
    const { transactionHash } = await request.json();
    if (!transactionHash || typeof transactionHash !== 'string' || !transactionHash.match(/^0x[a-fA-F0-9]{64}$/)) {
      log(`[validate-burned] [VALIDATION] Invalid transaction hash: ${transactionHash || 'undefined'}`);
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    const contractAddress = config.contractAddresses?.element280?.address;
    if (!contractAddress) {
      log(`[validate-burned] [VALIDATION] Element280 contract address not configured in config.js`);
      return NextResponse.json({ error: 'Contract address not configured' }, { status: 500 });
    }

    if (process.env.DEBUG === 'true') {
      log(`[validate-burned] [DEBUG] Fetching transaction receipt for hash: ${transactionHash}`);
    }
    const receipt = await getTransactionReceipt(transactionHash);
    if (!receipt) {
      log(`[validate-burned] [VALIDATION] Transaction receipt not found for hash: ${transactionHash}`);
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const burnAddress = '0x0000000000000000000000000000000000000000';
    const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
    const burnedTokenIds = [];

    for (const logEntry of receipt.logs) {
      if (
        logEntry.address.toLowerCase() === contractAddress.toLowerCase() &&
        logEntry.topics[0] === transferEvent.topics[0]
      ) {
        try {
          const decodedLog = client.decodeEventLog({
            abi: [transferEvent],
            data: logEntry.data,
            topics: logEntry.topics,
          });
          if (decodedLog.args.to.toLowerCase() === burnAddress) {
            burnedTokenIds.push(decodedLog.args.tokenId.toString());
          }
        } catch (decodeError) {
          log(`[validate-burned] [ERROR] Failed to decode log entry for transaction ${transactionHash}: ${decodeError.message}`);
        }
      }
    }

    if (burnedTokenIds.length === 0) {
      log(`[validate-burned] [VALIDATION] No burn events found in transaction: ${transactionHash}`);
      return NextResponse.json({ error: 'No burn events found in transaction' }, { status: 400 });
    }

    if (process.env.DEBUG === 'true') {
      log(`[validate-burned] [DEBUG] Found ${burnedTokenIds.length} burned tokens in transaction: ${transactionHash}`);
    }
    return NextResponse.json({
      transactionHash,
      burnedTokenIds,
      blockNumber: receipt.blockNumber.toString(),
    });
  } catch (error) {
    log(`[validate-burned] [ERROR] Error processing transaction: ${error.message}, stack: ${error.stack}`);
    return NextResponse.json({ error: 'Failed to validate transaction', details: error.message }, { status: 500 });
  }
}