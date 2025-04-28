// app/api/holders/Element280/validate-burned/route.js
import { NextResponse } from 'next/server';
import config from '@/config';
import { getTransactionReceipt, log, client } from '@/app/api/utils.js';
import { parseAbiItem } from 'viem';

export async function POST(request) {
  try {
    const { transactionHash } = await request.json();
    if (!transactionHash || typeof transactionHash !== 'string' || !transactionHash.match(/^0x[a-fA-F0-9]{64}$/)) {
      log(`[validate-burned] Invalid transaction hash: ${transactionHash}`);
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    log(`[validate-burned] Fetching transaction receipt for hash: ${transactionHash}`);
    const receipt = await getTransactionReceipt(transactionHash);
    if (!receipt) {
      log(`[validate-burned] Transaction receipt not found for hash: ${transactionHash}`);
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const contractAddress = config.contractAddresses.element280.address;
    if (!contractAddress) {
      log(`[validate-burned] Element280 contract address not configured`);
      return NextResponse.json({ error: 'Contract address not configured' }, { status: 500 });
    }

    const burnAddress = '0x0000000000000000000000000000000000000000';
    const transferEvent = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)');
    const burnedTokenIds = [];

    for (const logEntry of receipt.logs) {
      if (
        logEntry.address.toLowerCase() === contractAddress.toLowerCase() &&
        logEntry.topics[0] === transferEvent.topics[0]
      ) {
        const decodedLog = client.decodeEventLog({
          abi: [transferEvent],
          data: logEntry.data,
          topics: logEntry.topics,
        });
        if (decodedLog.args.to.toLowerCase() === burnAddress) {
          burnedTokenIds.push(decodedLog.args.tokenId.toString());
        }
      }
    }

    if (burnedTokenIds.length === 0) {
      log(`[validate-burned] No burn events found in transaction: ${transactionHash}`);
      return NextResponse.json({ error: 'No burn events found in transaction' }, { status: 400 });
    }

    log(`[validate-burned] Found ${burnedTokenIds.length} burned tokens in transaction: ${transactionHash}`);
    return NextResponse.json({
      transactionHash,
      burnedTokenIds,
      blockNumber: receipt.blockNumber.toString(),
    });
  } catch (error) {
    log(`[validate-burned] Error: ${error.message}`);
    console.error('[validate-burned] Error stack:', error.stack);
    return NextResponse.json({ error: 'Failed to validate transaction', details: error.message }, { status: 500 });
  }
}