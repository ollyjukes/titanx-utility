import HolderTable from './HolderTable';

export default function SearchResultsModal({ searchResult, searchAddress, closeModal, handleBackgroundClick }) {
  console.log("SearchResultsModal props:", { searchResult, searchAddress });
  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 px-2 sm:px-0"
      onClick={handleBackgroundClick}
    >
      <div
        className="bg-gray-800 rounded-xl shadow-2xl p-4 sm:p-6 w-full max-w-full sm:max-w-4xl max-h-[80vh] overflow-y-auto text-white"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl sm:text-2xl font-semibold text-white">
            Search Results for {searchAddress.slice(0, 6)}...{searchAddress.slice(-4)}
          </h2>
          <button
            onClick={closeModal}
            className="text-gray-400 hover:text-white text-xl sm:text-2xl font-bold focus:outline-none"
            aria-label="Close search results"
          >
            ×
          </button>
        </div>
        {Object.entries(searchResult)
          .filter(([contract, data]) => data && contract !== "unknown" && typeof data === "object" && data.wallet)
          .map(([contract, data]) => (
            <div key={contract} className="mb-4">
              <h3 className="text-lg sm:text-xl font-medium text-gray-300 mb-2">
                {contract === "element280" ? "Element 280" : contract === "staxNFT" ? "Stax NFT" : "Element 369"}
              </h3>
              <HolderTable holders={[data]} contract={contract} loading={false} />
            </div>
          ))}
      </div>
    </div>
  );
}