import config from '@/contracts/config';
import { HoldersResponseSchema, ProgressResponseSchema } from '@/client/lib/schemas';

// Debounce utility to prevent concurrent POST requests
const debounce = (func, wait) => {
  let timeout;
  return (...args) => {
    clearTimeout(timeout);
    return new Promise(resolve => {
      timeout = setTimeout(() => resolve(func(...args)), wait);
    });
  };
};

export async function fetchCollectionData(apiKey, apiEndpoint, pageSize) {
  console.log(`[FetchCollectionData] [INFO] Fetching ${apiKey} from ${apiEndpoint}`);
  try {
    if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
      console.log(`[FetchCollectionData] [INFO] ${apiKey} is disabled`);
      return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: 'Contract not deployed' };
    }

    const endpoint = apiEndpoint.startsWith('http')
      ? apiEndpoint
      : `${process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000'}${apiEndpoint}`;

    const pollProgress = async () => {
      const res = await fetch(`${endpoint}/progress`, {
        cache: 'no-store',
        signal: AbortSignal.timeout(config.alchemy.timeoutMs),
      });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Progress fetch failed: ${res.status} ${errorText}`);
      }
      const progress = await res.json();
      console.log(`[FetchCollectionData] [DEBUG] Progress: ${JSON.stringify(progress)}`);
      const validation = ProgressResponseSchema.safeParse(progress);
      if (!validation.success) {
        console.error(`[FetchCollectionData] [ERROR] Invalid progress data: ${JSON.stringify(validation.error.errors)}`);
        throw new Error('Invalid progress data');
      }
      return validation.data;
    };

    let allHolders = [];
    let totalTokens = 0;
    let totalShares = 0;
    let totalBurned = 0;
    let summary = {};
    let page = 0;
    let totalPages = Infinity;
    let postAttempts = 0;
    const maxPostAttempts = 5;
    let pollAttempts = 0;
    const maxPollAttempts = 360; // 180 seconds / 500ms = 360 attempts
    const maxPollTime = 180000; // 180 seconds
    const startTime = Date.now();

    // Debounced POST request
    const triggerPost = debounce(async () => {
      console.log(`[FetchCollectionData] [INFO] Triggering POST for ${apiKey}, attempt ${postAttempts + 1}/${maxPostAttempts}`);
      const res = await fetch(endpoint, {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ forceUpdate: false }),
      });
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[FetchCollectionData] [ERROR] POST failed: ${res.status} ${errorText}`);
        throw new Error(`POST request failed: ${res.status} ${errorText}`);
      }
      const response = await res.json();
      if (response.error) {
        throw new Error(`POST response error: ${response.error}`);
      }
      console.log(`[FetchCollectionData] [INFO] POST successful: ${JSON.stringify(response)}`);
      return response;
    }, 2000);

    let progress = await pollProgress();
    while (progress.phase !== 'Completed' && progress.phase !== 'Error') {
      if (Date.now() - startTime > maxPollTime) {
        console.error(`[FetchCollectionData] [ERROR] Cache population timeout for ${apiKey}`);
        return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: 'Cache population timed out' };
      }
      if (pollAttempts >= maxPollAttempts) {
        console.error(`[FetchCollectionData] [ERROR] Max poll attempts (${maxPollAttempts}) reached for ${apiKey}`);
        return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: 'Max poll attempts reached' };
      }
      if (progress.phase === 'Idle' || progress.totalOwners === 0) {
        if (postAttempts >= maxPostAttempts) {
          console.error(`[FetchCollectionData] [ERROR] Max POST attempts (${maxPostAttempts}) reached for ${apiKey}`);
          return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: 'Max POST attempts reached for cache population' };
        }
        try {
          console.log(`[FetchCollectionData] [DEBUG] Sending POST request, attempt ${postAttempts + 1}/${maxPostAttempts}`);
          await triggerPost();
          postAttempts++;
        } catch (error) {
          console.error(`[FetchCollectionData] [ERROR] POST attempt failed: ${error.message}`);
          postAttempts++;
          if (postAttempts >= maxPostAttempts) {
            console.error(`[FetchCollectionData] [ERROR] Max POST attempts (${maxPostAttempts}) reached after error`);
            return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: `Max POST attempts reached: ${error.message}` };
          }
        }
      }
      console.log(`[FetchCollectionData] [INFO] Waiting for ${apiKey} cache: ${progress.phase} (${progress.progressPercentage}%), poll attempt ${pollAttempts + 1}/${maxPollAttempts}`);
      await new Promise(resolve => setTimeout(resolve, config.alchemy.batchDelayMs));
      try {
        progress = await pollProgress();
      } catch (error) {
        console.error(`[FetchCollectionData] [ERROR] Poll attempt failed: ${error.message}`);
        return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: `Polling failed: ${error.message}` };
      }
      pollAttempts++;
    }

    if (progress.phase === 'Error') {
      console.error(`[FetchCollectionData] [ERROR] Cache population failed for ${apiKey}: ${progress.error || 'Unknown error'}`);
      return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: `Cache population failed: ${progress.error || 'Unknown error'}` };
    }

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
        return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: `API request failed: ${res.status} ${errorText}` };
      }

      const json = await res.json();
      console.log(`[FetchCollectionData] [DEBUG] Response: ${JSON.stringify(json, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);

      if (json.error) {
        console.error(`[FetchCollectionData] [ERROR] API error for ${apiKey}: ${json.error}`);
        return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: json.error };
      }

      const validation = HoldersResponseSchema.safeParse(json);
      if (!validation.success) {
        console.error(`[FetchCollectionData] [ERROR] Invalid holders data: ${JSON.stringify(validation.error.errors)}`);
        // Retry POST for all collections if data is invalid
        if (postAttempts >= maxPostAttempts) {
          console.error(`[FetchCollectionData] [ERROR] Max POST attempts (${maxPostAttempts}) reached for ${apiKey} retry`);
          return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: 'Max POST attempts reached for retry' };
        }
        console.log(`[FetchCollectionData] [INFO] Triggering POST retry for ${apiKey} due to invalid data`);
        await triggerPost();
        postAttempts++;
        const retryRes = await fetch(url, { cache: 'no-store' });
        if (!retryRes.ok) {
          const retryError = await retryRes.text();
          console.error(`[FetchCollectionData] [ERROR] Retry failed: ${retryRes.status} ${retryError}`);
          return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: `Retry failed: ${retryRes.status} ${retryError}` };
        }
        const retryJson = await retryRes.json();
        console.log(`[FetchCollectionData] [DEBUG] Retry response: ${JSON.stringify(retryJson, (k, v) => typeof v === 'bigint' ? v.toString() : v)}`);
        const retryValidation = HoldersResponseSchema.safeParse(retryJson);
        if (!retryValidation.success) {
          console.error(`[FetchCollectionData] [ERROR] Retry invalid holders data: ${JSON.stringify(retryValidation.error.errors)}`);
          return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: 'Invalid holders data after retry' };
        }
        // Use retry data
        allHolders = allHolders.concat(retryJson.holders);
        totalTokens = retryJson.totalTokens || retryJson.summary?.totalLive || totalTokens;
        totalShares = retryJson.totalShares || retryJson.summary?.multiplierPool || totalTokens;
        totalBurned = retryJson.totalBurned || totalBurned;
        summary = retryJson.summary || summary;
        totalPages = retryJson.totalPages || 1;
      } else {
        // Use original data
        allHolders = allHolders.concat(json.holders);
        totalTokens = json.totalTokens || json.summary?.totalLive || totalTokens;
        totalShares = json.totalShares || json.summary?.multiplierPool || totalTokens;
        totalBurned = json.totalBurned || totalBurned;
        summary = json.summary || summary;
        totalPages = json.totalPages || 1;
      }
      page++;
      console.log(`[FetchCollectionData] [INFO] Fetched page ${page}: ${json.holders.length} holders`);
    }

    return { holders: allHolders, totalTokens, totalShares, totalBurned, summary };
  } catch (error) {
    console.error(`[FetchCollectionData] [ERROR] ${apiKey}: ${error.message}, stack: ${error.stack}`);
    return { holders: [], totalTokens: 0, totalShares: 0, totalBurned: 0, error: error.message };
  }
}