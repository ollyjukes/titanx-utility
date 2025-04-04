// app/nft/page.js
import NFTHoldersDashboard from "@/components/NFTHoldersDashboard"; // Corrected path

export default function NFTPage() {
  const initialHoldersData = {
    element280: [],
    staxNFT: [],
    element369: [],
  };

  return <NFTHoldersDashboard holdersData={initialHoldersData} />;
}