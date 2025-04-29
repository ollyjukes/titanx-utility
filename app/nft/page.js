// app/nft/page.js
import NFTSummary from '@/components/NFTSummary';
import config from '@/config';

// Fetch data for a single collection
async function fetchCollectionData(apiKey, apiEndpoint, pageSize) {
  console.log(`[NFTOverview] Fetching data for ${apiKey} from ${apiEndpoint}`);
  try {
    if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
      console.log(`[NFTOverview] ${apiKey} is disabled`);
      return { error: `${apiKey} is not available` };
    }

    let endpoint = apiEndpoint;
    if (!endpoint || !endpoint.startsWith('http')) {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
      endpoint = `${baseUrl}${apiEndpoint}`;
      console.log(`[NFTOverview] Adjusted endpoint: ${endpoint}`);
    }

    let allHolders = [];
    let totalTokens = 0;
    let totalShares = 0;
    let summary = {};
    let page = 0;
    let totalPages = Infinity;

    while (page < totalPages) {
      const url = `${endpoint}?page=${page}&pageSize=${pageSize}`;
      console.log(`[NFTOverview] Fetching ${url}`);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch ${url}: ${res.status} ${errorText}`);
      }

      const json = await res.json();
      if (json.error) {
        console.log(`[NFTOverview] API error for ${apiKey}: ${json.error}`);
        return { error: json.error };
      }
      if (!json.holders || !Array.isArray(json.holders)) {
        throw new Error(`Invalid holders data for ${url}`);
      }

      allHolders = allHolders.concat(json.holders);
      totalTokens = json.totalTokens || json.summary?.totalLive || totalTokens;
      totalShares = json.totalShares || json.summary?.multiplierPool || totalShares;
      summary = json.summary || summary;
      totalPages = json.totalPages || 1;
      page++;
      console.log(`[NFTOverview] Fetched page ${page} for ${apiKey}: ${json.holders.length} holders`);
    }

    return {
      holders: allHolders,
      totalTokens,
      totalShares,
      summary,
    };
  } catch (error) {
    console.error(`[NFTOverview] Error fetching ${apiKey}: ${error.message}`);
    return { error: error.message };
  }
}

// Fetch data for all collections
async function fetchCollectionsData() {
  const collections = Object.keys(config.contractDetails).map((key) => ({
    apiKey: key,
    ...config.contractDetails[key],
  }));

  const collectionsData = await Promise.all(
    collections.map(async ({ apiKey, apiEndpoint, pageSize }) => {
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
      {collectionsData.some(({ data }) => data.error) ? (
        <p className="text-error">Error fetching data: {collectionsData.find(({ data }) => data.error)?.data.error}</p>
      ) : (
        <NFTSummary collectionsData={collectionsData} />
      )}
    </div>
  );
}