// components/NFTPageWrapper.js
'use client';

import dynamic from 'next/dynamic';
import config from '@/config.js';
import { useEffect } from 'react';
import { useNFTStore } from '@/app/store';

const holderTableComponents = {
  element280: dynamic(() => import('./HolderTable/Element280').catch(() => ({ default: () => <div className="text-error">Error loading Element280 data</div> })), {
    ssr: false,
    loading: () => <div className="text-body">Loading Element280 data...</div>,
  }),
  element369: dynamic(() => import('./HolderTable/Element369').catch(() => ({ default: () => <div className="text-error">Error loading Element369 data</div> })), {
    ssr: false,
    loading: () => <div className="text-body">Loading Element369 data...</div>,
  }),
  stax: dynamic(() => import('./HolderTable/Stax').catch(() => ({ default: () => <div className="text-error">Error loading Stax data</div> })), {
    ssr: false,
    loading: () => <div className="text-body">Loading Stax data...</div>,
  }),
  ascendant: dynamic(() => import('./HolderTable/Ascendant').catch(() => ({ default: () => <div className="text-error">Error loading Ascendant data</div> })), {
    ssr: false,
    loading: () => <div className="text-body">Loading Ascendant data...</div>,
  }),
  e280: dynamic(() => import('./HolderTable/E280').catch(() => ({ default: () => <div className="text-error">Error loading E280 data</div> })), {
    ssr: false,
    loading: () => <div className="text-body">Loading E280 data...</div>,
  }),
};

export default function NFTPageWrapper({ chain, contract, data, rewardToken }) {
  const { setCache } = useNFTStore();

  useEffect(() => {
    if (data && contract) {
      console.log(`[NFTPageWrapper] Setting cache for ${contract}: ${data.holders?.length} holders`);
      setCache(contract, data);
    }
  }, [contract, data, setCache]);

  console.log('[NFTPageWrapper] Props:', { chain, contract, data: data?.holders?.length, rewardToken });

  if (!contract || !data) {
    return <div className="text-error">Invalid collection data.</div>;
  }

  const HolderTable = holderTableComponents[contract];
  if (!HolderTable) {
    return <div className="text-error">No table component found for {contract}.</div>;
  }

  return (
    <div className="card">
      <div className="space-y-section">
        <h2 className="subtitle">{config.contractDetails[contract]?.name || contract} Holders</h2>
        <HolderTable
          holders={data.holders || []}
          contract={contract}
          loading={false}
          totalTokens={data.totalTokens || 0}
          totalShares={data.totalShares}
          rewardToken={rewardToken || config.contractDetails[contract]?.rewardToken}
        />
      </div>
    </div>
  );
}