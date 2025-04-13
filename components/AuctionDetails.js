// components/AuctionDetails.js
'use client';
import { useMemo } from 'react';

export default function AuctionDetails({ roiData }) {
  const { isLoading, hasError, status, data, protocol } = roiData || {};

  const content = useMemo(() => {
    if (!protocol) return <p className="text-gray-300 text-sm">No data available.</p>;
    if (isLoading) return <p className="text-gray-300 text-sm">Loading {protocol} data...</p>;
    if (hasError || status === 'error') return <p className="text-red-500 text-sm">Error loading {protocol} data.</p>;
    if (status === 'no_data') return <p className="text-gray-300 text-sm">No {protocol} auction data available.</p>;

    return (
      <div className="text-gray-300 text-sm mt-2">
        <p><strong>ROI:</strong> {data.roi ? `${data.roi}%` : 'N/A'}</p>
        <p><strong>Auction Rate:</strong> {data.auctionRate ? `${data.auctionRate.toFixed(2)} ${protocol.toUpperCase()}/TX` : 'N/A'}</p>
        <p><strong>Market Rate:</strong> {data.marketRate ? `${data.marketRate.toFixed(2)} ${protocol.toUpperCase()}/TX` : 'N/A'}</p>
        {data.secondaryRate && protocol === 'Flare' && (
          <p><strong>FLARE/X28:</strong> {data.secondaryRate.toFixed(2)} FLARE/X28</p>
        )}
        {data.secondaryRate && protocol === 'Ascendant' && (
          <>
            <p><strong>ASCEND/DRAGONX:</strong> {data.secondaryRate.toFixed(2)} ASCEND/DRAGONX</p>
            {data.marketDragonXPerTitanX && (
              <p><strong>DRAGONX/TITANX:</strong> {data.marketDragonXPerTitanX.toFixed(2)} DRAGONX/TX</p>
            )}
          </>
        )}
      </div>
    );
  }, [isLoading, hasError, status, data, protocol]);

  return content;
}