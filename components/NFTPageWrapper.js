'use client';

import dynamic from 'next/dynamic';
import config from '@/config.js';

// Loading components
const Element280Loading = () => <div className="text-body">Loading Element280 data...</div>;
const Element369Loading = () => <div className="text-body">Loading Element369 data...</div>;
const StaxLoading = () => <div className="text-body">Loading Stax data...</div>;
const AscendantLoading = () => <div className="text-body">Loading Ascendant data...</div>;
const E280Loading = () => <div className="text-body">Loading E280 data...</div>;

// Fallback components
const Element280Fallback = () => <div className="text-error">Error loading Element280 data</div>;
const Element369Fallback = () => <div className="text-error">Error loading Element369 data</div>;
const StaxFallback = () => <div className="text-error">Error loading Stax data</div>;
const AscendantFallback = () => <div className="text-error">Error loading Ascendant data</div>;
const E280Fallback = () => <div className="text-error">Error loading E280 data</div>;

const holderTableComponents = {
  element280: dynamic(() => import('./HolderTable/Element280').catch(() => ({ default: Element280Fallback })), {
    ssr: false,
    loading: Element280Loading,
  }),
  element369: dynamic(() => import('./HolderTable/Element369').catch(() => ({ default: Element369Fallback })), {
    ssr: false,
    loading: Element369Loading,
  }),
  stax: dynamic(() => import('./HolderTable/Stax').catch(() => ({ default: StaxFallback })), {
    ssr: false,
    loading: StaxLoading,
  }),
  ascendant: dynamic(() => import('./HolderTable/Ascendant').catch(() => ({ default: AscendantFallback })), {
    ssr: false,
    loading: AscendantLoading,
  }),
  e280: dynamic(() => import('./HolderTable/E280').catch(() => ({ default: E280Fallback })), {
    ssr: false,
    loading: E280Loading,
  }),
};

Object.keys(holderTableComponents).forEach((key) => {
  holderTableComponents[key].displayName = `${key}HolderTable`;
});

export default function NFTPageWrapper({ chain, contract, data, rewardToken }) {
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