// app/api/holders/Element280/validate-burned/route.js
import { NextResponse } from 'next/server';
import config from '@/config';
import { client, logger, getCache, setCache } from '@/app/api/utils';
import { parseAbiItem } from 'viem';

export async function POST(request) {
  if (process.env.DEBUG === 'true') {
    logger.debug('element280-validate-burned', 'Processing POST request for validate-burned', 'eth', 'element280');
  }

  try {
    const { transactionHash } = await request.json();
    if (!transactionHash || typeof transactionHash !== 'string' || !transactionHash.match(/^0x[a-fA-F0-9]{64}$/)) {
      logger.warn('element280-validate-burned', `Invalid transaction hash: ${transactionHash || 'undefined'}`, 'eth', 'element280');
      return NextResponse.json({ error: 'Invalid transaction hash' }, { status: 400 });
    }

    const contractAddress = config.nftContracts?.element280?.address;
    if (!contractAddress) {
      logger.error('element280-validate-burned', 'Element280 contract address not configured', {}, 'eth', 'element280');
      return NextResponse.json({ error: 'Contract address not configured' }, { status: 500 });
    }

    const cacheKey = `element280_burn_validation_${transactionHash}`;
    const cachedResult = await getCache(cacheKey, 'element280');
    if (cachedResult) {
      if (process.env.DEBUG === 'true') {
        logger.debug('element280-validate-burned', `Cache hit for burn validation: ${transactionHash}`, 'eth', 'element280');
      }
      return NextResponse.json(cachedResult);
    }

    if (process.env.DEBUG === 'true') {
      logger.debug('element280-validate-burned', `Fetching transaction receipt for hash: ${transactionHash}`, 'eth', 'element280');
    }
    const receipt = await client.getTransactionReceipt({ hash: transactionHash });
    if (!receipt) {
      logger.warn('element280-validate-burned', `Transaction receipt not found for hash: ${transactionHash}`, 'eth', 'element280');
      return NextResponse.json({ error: 'Transaction not found' }, { status: 404 });
    }

    const burnAddress = config.burnAddress;
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
          logger.error('element280-validate-burned', `Failed to decode log entry for transaction ${transactionHash}: ${decodeError.message}`, { stack: decodeError.stack }, 'eth', 'element280');
        }
      }
    }

    if (burnedTokenIds.length === 0) {
      logger.warn('element280-validate-burned', `No burn events found in transaction: ${transactionHash}`, 'eth', 'element280');
      return NextResponse.json({ error: 'No burn events found in transaction' }, { status: 400 });
    }

    const result = {
      transactionHash,
      burnedTokenIds,
      blockNumber: receipt.blockNumber.toString(),
    };

    await setCache(cacheKey, result, config.cache.nodeCache.stdTTL, 'element280');
    if (process.env.DEBUG === 'true') {
      logger.debug('element280-validate-burned', `Found ${burnedTokenIds.length} burned tokens in transaction: ${transactionHash}`, 'eth', 'element280');
    }
    return NextResponse.json(result);
  } catch (error) {
    logger.error('element280-validate-burned', `Error processing transaction: ${error.message}`, { stack: error.stack }, 'eth', 'element280');
    return NextResponse.json({ error: 'Failed to validate transaction', details: error.message }, { status: 500 });
  }
}