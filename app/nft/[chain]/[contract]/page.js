// app/nft/[chain]/[contract]/page.js
import NFTPage from '@/components/NFTPage';
import { ProgressResponseSchema, HoldersResponseSchema } from '@/app/lib/schemas';
import config from '@/app/contracts_nft';

export default async function NFTContractPage({ params }) {
  const { chain, contract } = params;
  const apiKeyMap = {
    Element280: 'element280',
    Element369: 'element369',
    Stax: 'stax',
    Ascendant: 'ascendant',
    E280: 'e280',
  };
  const contractKey = apiKeyMap[contract];

  if (!config.supportedChains.includes(chain) || !contractKey || config.contractDetails[contractKey]?.disabled) {
    return { notFound: true };
  }

  const contractConfig = config.contractDetails[contractKey] || {};
  let initialProgress = { step: 'idle', progressPercentage: '0%' };
  let initialData = { status: 'pending', holders: [], error: null };

  try {
    // Fetch progress state
    const progressRes = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/api/holders/cache/state/${contractKey}`, {
      cache: 'no-store',
    });
    if (progressRes.ok) {
      const progressData = await progressRes.json();
      ProgressResponseSchema.parse(progressData);
      initialProgress = {
        step: progressData.progressState.step,
        progressPercentage: progressData.progressState.progressPercentage,
      };
    } else {
      throw new Error(`Progress API error: ${progressRes.status}`);
    }

    // Fetch holders data
    const correctedApiEndpoint = contractConfig.apiEndpoint
      ?.replace(/Element280/, 'element280')
      .replace(/Stax/, 'stax')
      .replace(/Element369/, 'element369')
      .replace(/Ascendant/, 'ascendant');
    if (correctedApiEndpoint) {
      const res = await fetch(`${correctedApiEndpoint}?page=0&pageSize=${contractConfig.pageSize || 1000}`, {
        cache: 'no-store',
      });
      if (!res.ok) throw new Error(`Holders API error: ${res.status}`);
      const data = await res.json();
      HoldersResponseSchema.parse({ ...data, contractKey });
      initialData = data;
    } else {
      initialData = { error: 'Invalid contract configuration' };
    }
  } catch (err) {
    console.error('[NFTContractPage] Fetch error:', err.message);
    initialData = { error: `Failed to load data: ${err.message}` };
  }

  return <NFTPage contractKey={contractKey} initialData={initialData} initialProgress={initialProgress} />;
}

export async function getServerSideProps({ params }) {
  return { props: { params } };
}