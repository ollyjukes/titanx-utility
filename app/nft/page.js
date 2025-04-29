// app/nft/page.js
import NFTSummary from '@/components/NFTSummary';
import config from '@/config';

// Fetch data for a single collection
async function fetchCollectionData(apiKey, apiEndpoint, pageSize) {
  console.log(`[NFTOverview] Fetching data for ${apiKey} from ${apiEndpoint}`);
  try {
    if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
      console.log(`[NFTOverview] ${apiKey} is disabled, returning empty data`);
      return { holders: [], totalTokens: 0, error: 'Contract not deployed' };
    }

    let endpoint = apiEndpoint;
    if (!endpoint || !endpoint.startsWith('http')) {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
      endpoint = `${baseUrl}/api/holders/${apiKey}`;
      console.log(`[NFTOverview] Adjusted endpoint to ${endpoint}`);
    }

    let allHolders = [];
    let totalTokens = 0;
    let totalLockedAscendant = 0;
    let toDistributeDay8 = 0;
    let toDistributeDay28 = 0;
    let toDistributeDay90 = 0;
    let pendingRewards = 0;
    let summary = {};
    let page = 0;
    let totalPages = Infinity;

    while (page < totalPages) {
      const url = `${endpoint}?page=${page}&pageSize=${pageSize}`;
      console.log(`[NFTOverview] Fetching ${url}`);
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) {
        const errorText = await res.text();
        console.error(`[NFTOverview] Failed to fetch ${url}: ${res.status} ${errorText}`);
        return { holders: [], totalTokens: 0, error: `API request failed: ${res.status}` };
      }

      const json = await res.json();
      if (json.error) {
        console.log(`[NFTOverview] API error for ${apiKey}: ${json.error}`);
        return { holders: [], totalTokens: 0, error: json.error };
      }
      if (!json.holders || !Array.isArray(json.holders)) {
        console.error(`[NFTOverview] Invalid holders data for ${url}`);
        return { holders: [], totalTokens: 0, error: 'Invalid holders data' };
      }

      allHolders = allHolders.concat(json.holders);
      totalTokens = json.totalTokens || json.summary?.totalLive || totalTokens;
      totalLockedAscendant = json.totalLockedAscendant || totalLockedAscendant;
      toDistributeDay8 = json.toDistributeDay8 || toDistributeDay8;
      toDistributeDay28 = json.toDistributeDay28 || toDistributeDay28;
      toDistributeDay90 = json.toDistributeDay90 || toDistributeDay90;
      pendingRewards = json.pendingRewards || pendingRewards;
      summary = json.summary || summary;
      totalPages = json.totalPages || 1;
      page++;
      console.log(`[NFTOverview] Successfully fetched page ${page} for ${apiKey}: ${json.holders.length} holders`);
    }

    return {
      holders: allHolders,
      totalTokens,
      totalLockedAscendant,
      toDistributeDay8,
      toDistributeDay28,
      toDistributeDay90,
      pendingRewards,
      summary,
    };
  } catch (error) {
    console.error(`[NFTOverview] Error fetching ${apiKey}: ${error.message}`);
    return { holders: [], totalTokens: 0, error: error.message };
  }
}

// Fetch data for all collections
async function fetchCollectionsData() {
  const collections = Object.keys(config.contractDetails).map((key) => ({
    apiKey: key,
    ...config.contractDetails[key],
  }));

  const collectionsData = await Promise.all(
    collections.map(async ({ apiKey, apiEndpoint, pageSize, disabled }) => {
      if (disabled) {
        console.log(`[NFTOverview] ${apiKey} is disabled, returning empty data`);
        return { apiKey, data: { holders: [], totalTokens: 0, error: 'Contract not deployed' } };
      }
      const data = await fetchCollectionData(apiKey, apiEndpoint, pageSize || 1000);
      return { apiKey, data };
    })
  );

  return collectionsData;
}

export const revalidate = 60; // Revalidate every 60 seconds

export default async function NFTOverview() {
  const collectionsData = await fetchCollectionsData();

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6 flex flex-col items-center">
      <h1 className="title mb-6">NFT Collections</h1>
      {collectionsData.every(({ data }) => data.error) ? (
        <p className="text-error">
          Error fetching data: {collectionsData.find(({ data }) => data.error)?.data.error}
        </p>
      ) : (
        <NFTSummary collectionsData={collectionsData} />
      )}
    </div>
  );
}