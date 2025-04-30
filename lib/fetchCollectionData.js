// lib/fetchCollectionData.js
import config from '@/config';

export async function fetchCollectionData(apiKey, apiEndpoint, pageSize) {
  console.log(`[FetchCollectionData] [INFO] Fetching ${apiKey} from ${apiEndpoint}`);
  try {
    if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
      return { holders: [], totalTokens: 0, totalBurned: 0, error: 'Contract not deployed' };
    }

    let endpoint = apiEndpoint.startsWith('http') ? apiEndpoint : `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}${apiEndpoint}`;
    
    // Poll /progress until cache is complete
    let progress;
    let attempts = 0;
    const maxAttempts = config.alchemy.maxRetries;
    while (attempts < maxAttempts) {
      try {
        const res = await fetch(`${endpoint}/progress`, { cache: 'force-cache', signal: AbortSignal.timeout(config.alchemy.timeoutMs) });
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Progress fetch failed: ${res.status} ${errorText}`);
        }
        progress = await res.json();
        if (progress.phase === 'Idle' || progress.totalOwners === 0) {
          console.log(`[FetchCollectionData] [INFO] Triggering POST for ${apiKey}`);
          const postRes = await fetch(endpoint, { method: 'POST', cache: 'force-cache' });
          if (!postRes.ok) {
            const errorText = await postRes.text();
            console.error(`[FetchCollectionData] [ERROR] Cache population trigger failed: ${postRes.status} ${errorText}`);
            throw new Error(`Cache population trigger failed: ${postRes.status}`);
          }
        }
        break;
      } catch (error) {
        attempts++;
        console.error(`[FetchCollectionData] [ERROR] Progress fetch attempt ${attempts}/${maxAttempts} failed: ${error.message}`);
        if (attempts >= maxAttempts) {
          return { holders: [], totalTokens: 0, totalBurned: 0, error: 'Failed to fetch cache progress' };
        }
        await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs * attempts));
      }
    }

    const maxPollTime = 60000; // 60 seconds max polling
    const startTime = Date.now();
    while (progress.phase !== 'Completed' && progress.phase !== 'Error') {
      if (Date.now() - startTime > maxPollTime) {
        console.error(`[FetchCollectionData] [ERROR] Cache population timeout for ${apiKey}`);
        return { holders: [], totalTokens: 0, totalBurned: 0, error: 'Cache population timed out' };
      }
      console.log(`[FetchCollectionData] [INFO] Waiting for ${apiKey} cache: ${progress.phase} (${progress.progressPercentage}%)`);
      await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
      const res = await fetch(`${endpoint}/progress`, { cache: 'force-cache', signal: AbortSignal.timeout(config.alchemy.timeoutMs) });
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[FetchCollectionData] [ERROR] Progress fetch failed: ${res.status} ${errorText}`);
        return { holders: [], totalTokens: 0, totalBurned: 0, error: 'Failed to fetch cache progress' };
      }
      progress = await res.json();
    }

    if (progress.phase === 'Error') {
      console.error(`[FetchCollectionData] [ERROR] Cache population failed for ${apiKey}: ${progress.error || 'Unknown error'}`);
      return { holders: [], totalTokens: 0, totalBurned: 0, error: `Cache population failed: ${progress.error || 'Unknown error'}` };
    }

    let allHolders = [];
    let totalTokens = 0;
    let totalShares = 0;
    let totalBurned = 0;
    let summary = {};
    let page = 0;
    let totalPages = Infinity;

    while (page < totalPages) {
      const url = `${endpoint}?page=${page}&pageSize=${pageSize}`;
      console.log(`[FetchCollectionData] [DEBUG] Fetching ${url}`);
      const res = await fetch(url, { cache: 'force-cache' });
      console.log(`[FetchCollectionData] [DEBUG] Status: ${res.status}, headers: ${JSON.stringify([...res.headers])}`);

      if (res.status === 202) {
        console.log(`[FetchCollectionData] [INFO] Cache still populating for ${apiKey}, retrying...`);
        await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
        continue;
      }

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[FetchCollectionData] [ERROR] Failed: ${res.status} ${errorText}`);
        throw new Error(`API request failed: ${res.status}`);
      }

      const json = await res.json();
      console.log(`[FetchCollectionData] [DEBUG] Response: ${JSON.stringify(json, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);

      if (json.error) {
        console.error(`[FetchCollectionData] [ERROR] API error: ${json.error}`);
        throw new Error(json.error);
      }
      if (!json.holders || !Array.isArray(json.holders)) {
        console.error(`[FetchCollectionData] [ERROR] Invalid holders: ${JSON.stringify(json)}`);
        if (apiKey === 'ascendant') {
          console.log(`[FetchCollectionData] [INFO] Triggering POST for ${apiKey}`);
          await fetch(endpoint, { method: 'POST', cache: 'force-cache' });
          const retryRes = await fetch(url, { cache: 'no-store' });
          if (!retryRes.ok) {
            const retryError = await retryRes.text();
            console.error(`[FetchCollectionData] [ERROR] Retry failed: ${retryRes.status} ${retryError}`);
            throw new Error(`Retry failed: ${retryRes.status}`);
          }
          const retryJson = await retryRes.json();
          console.log(`[FetchCollectionData] [DEBUG] Retry response: ${JSON.stringify(retryJson, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
          if (!retryJson.holders || !Array.isArray(retryJson.holders)) {
            console.error(`[FetchCollectionData] [ERROR] Retry invalid holders: ${JSON.stringify(retryJson)}`);
            throw new Error('Invalid holders data after retry');
          }
          json.holders = retryJson.holders;
          json.totalTokens = retryJson.totalTokens;
          json.totalShares = retryJson.totalShares;
          json.totalBurned = retryJson.totalBurned;
          json.summary = retryJson.summary;
          json.totalPages = retryJson.totalPages;
        } else {
          throw new Error('Invalid holders data');
        }
      }

      allHolders = allHolders.concat(json.holders);
      totalTokens = json.totalTokens || json.summary?.totalLive || totalTokens;
      totalShares = json.totalShares || json.summary?.multiplierPool || totalTokens;
      totalBurned = json.totalBurned || totalBurned;
      summary = json.summary || summary;
      totalPages = json.totalPages || 1;
      page++;
      console.log(`[FetchCollectionData] [INFO] Fetched page ${page}: ${json.holders.length} holders`);
    }

    return { holders: allHolders, totalTokens, totalShares, totalBurned, summary };
  } catch (error) {
    console.error(`[FetchCollectionData] [ERROR] ${apiKey}: ${error.message}, stack: ${error.stack}`);
    return { holders: [], totalTokens: 0, totalBurned: 0, error: error.message };
  }
}