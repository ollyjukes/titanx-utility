// components/NFTPage.js
import HolderTable from '@/components/HolderTable';
import LoadingIndicator from '@/components/LoadingIndicator';
import CollectionSelector from '@/components/CollectionSelector';
import config from '@/app/contracts_nft';

export default function NFTPage({ contractKey, initialData, initialProgress }) {
  const { name, apiEndpoint, rewardToken } = config.contractDetails[contractKey.toLowerCase()] || {};

  const renderSummary = (data) => {
    if (!data) return null;
    const totalMultiplierSum = data.holders.reduce((sum, h) => sum + (h.multiplierSum || 0), 0);
    const totalTokens = data.totalTokens || 0;
    const summary = data.summary || {};
    return (
      <>
        <h2 className="text-2xl font-semibold mb-2">Summary</h2>
        <div className="summary-item"><span className="summary-label">Unique Wallets:</span><span>{data.holders.length}</span></div>
        <div className="summary-item"><span className="summary-label">Active NFTs:</span><span>{(summary.totalLive || totalTokens).toLocaleString()}</span></div>
        <div className="summary-item"><span className="summary-label">Burned NFTs:</span><span>{(summary.totalBurned || 0).toLocaleString()}</span></div>
        <div className="summary-item"><span className="summary-label">Minted NFTs:</span><span>{(summary.totalMinted || 0).toLocaleString()}</span></div>
        <div className="summary-item"><span className="summary-label">Multiplier Pool:</span><span>{(summary.multiplierPool || totalMultiplierSum).toLocaleString()}</span></div>
        <div className="summary-item"><span className="summary-label">Buy Transactions:</span><span>{data.transferSummary?.buyCount || 0}</span></div>
        <div className="summary-item"><span className="summary-label">Sell Transactions:</span><span>{data.transferSummary?.sellCount || 0}</span></div>
        <div className="summary-item"><span className="summary-label">Burn Transactions:</span><span>{data.transferSummary?.burnCount || 0}</span></div>
      </>
    );
  };

  return (
    <div className="min-h-screen bg-transparent text-white p-6 flex flex-col items-center">
      <h1 className="text-4xl font-bold mb-6">{name || 'Unknown Contract'} Holders</h1>
      <CollectionSelector currentCollection={contractKey} />
      {initialData.status === 'pending' || !initialData.holders ? (
        <LoadingIndicator status={`Loading ${name || 'contract'} holders: ${initialProgress.step} (${initialProgress.progressPercentage})`} />
      ) : initialData.error ? (
        <p className="text-red-500 text-lg">Error: {initialData.error}</p>
      ) : !initialData.holders.length ? (
        <p className="text-gray-400 text-lg">No data available for {name || 'this contract'}.</p>
      ) : (
        <div className="w-full max-w-6xl">
          <div className="mb-6 p-4 bg-gray-800 rounded-lg shadow">{renderSummary(initialData)}</div>
          <HolderTable holders={initialData.holders || []} contract={contractKey} loading={false} />
        </div>
      )}
    </div>
  );
}