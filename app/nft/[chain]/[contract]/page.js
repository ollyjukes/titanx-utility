// app/nft/[chain]/[contract]/page.js
import { notFound } from 'next/navigation';
import NFTPageWrapper from '@/components/NFTPageWrapper';
import config from '@/config';
import { useNFTStore } from '@/app/store';

// Fetch data for a single collection
async function fetchCollectionData(apiKey, apiEndpoint, pageSize) {
  console.log(`[NFTContractPage] Fetching data for ${apiKey} from ${apiEndpoint}`);
  try {
    if (apiKey === 'e280' || config.contractDetails[apiKey]?.disabled) {
      console.log(`[NFTContractPage] ${apiKey} is disabled`);
      return { error: `${apiKey} is not available` };
    }

    let endpoint = apiEndpoint;
    if (!endpoint || !endpoint.startsWith('http')) {
      const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3000';
      endpoint = `${baseUrl}${apiEndpoint}`;
      console.log(`[NFTContractPage] Adjusted endpoint: ${endpoint}`);
    }

    let allHolders = [];
    let totalTokens = 0;
    let totalShares = 0;
    let summary = {};
    let page = 0;
    let totalPages = Infinity;

    while (page < totalPages) {
      const url = `${endpoint}?page=${page}&pageSize=${pageSize}`;
      console.log(`[NFTContractPage] Fetching ${url}`);
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to fetch ${url}: ${res.status} ${errorText}`);
      }

      const json = await res.json();
      if (json.error) {
        console.log(`[NFTContractPage] API error for ${apiKey}: ${json.error}`);
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
      console.log(`[NFTContractPage] Fetched page ${page} for ${apiKey}: ${json.holders.length} holders`);
    }

    const data = {
      holders: allHolders,
      totalTokens,
      totalShares,
      summary,
    };

    console.log(`[NFTContractPage] Setting cache for ${apiKey}: ${allHolders.length} holders`);
    useNFTStore.getState().setCache(apiKey, data);

    return data;
  } catch (error) {
    console.error(`[NFTContractPage] Error fetching ${apiKey}: ${error.message}`);
    return { error: error.message };
  }
}

export const revalidate = 60; // Revalidate every 60 seconds

export default async function NFTContractPage({ params }) {
  const { chain, contract } = params;

  // Map contract name to apiKey
  const apiKeyMap = {
    Element280: 'element280',
    Element369: 'element369',
    Stax: 'stax',
    Ascendant: 'ascendant',
    E280: 'e280',
  };
  const apiKey = apiKeyMap[contract];

  if (!config.supportedChains.includes(chain) || !apiKey) {
    console.log(`[NFTContractPage] Not found: chain=${chain}, contract=${contract}`);
    notFound();
  }

  const contractConfig = config.contractDetails[apiKey] || {};
  const data = await fetchCollectionData(apiKey, contractConfig.apiEndpoint, contractConfig.pageSize || 1000);

  if (data.error) {
    return (
      <div className="container page-content">
        <h1 className="title mb-6">{contract} Collection</h1>
        <p className="text-error">{data.error}</p>
      </div>
    );
  }

  return (
    <div className="container page-content">
      <h1 className="title mb-6">{contract} Collection</h1>
      <NFTPageWrapper
        chain={chain}
        contract={apiKey}
        data={data}
        rewardToken={config.contractDetails[apiKey]?.rewardToken}
      />
    </div>
  );
}