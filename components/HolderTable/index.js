// components/HolderTable/index.js
'use client';

import Element280 from './Element280';
import Element369 from './Element369';
import Stax from './Stax';
import Ascendant from './Ascendant';
import E280 from './E280';

const HolderTable = ({ chain, contract, holders, totalTokens, totalShares, rewardToken, totalBurned }) => {
  const components = {
    element280: Element280,
    element369: Element369,
    stax: Stax,
    ascendant: Ascendant,
    e280: E280,
  };

  const TableComponent = components[contract];
  if (!TableComponent) {
    return <div>Invalid contract: {contract}</div>;
  }

  return (
    <TableComponent
      chain={chain}
      holders={holders}
      totalTokens={totalTokens}
      totalShares={totalShares}
      rewardToken={rewardToken}
      totalBurned={totalBurned}
    />
  );
};

export default HolderTable;