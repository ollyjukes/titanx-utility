// app/components/ProtocolTabs.js
export default function ProtocolTabs({ activeTab, setActiveTab, loading }) {
    const tabs = [
      { id: "element280", label: "Element 280" },
      { id: "staxNFT", label: "Stax NFT" },
      { id: "element369", label: "Element 369" },
    ];
  
    return (
      <nav className="px-4 sm:px-6 py-2 sm:py-4 border-b border-gray-700">
        <div className="flex flex-wrap gap-2 sm:gap-4">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              disabled={loading}
              className={`py-2 px-3 sm:py-3 sm:px-6 font-medium text-gray-300 rounded-t-lg transition-all duration-200 text-sm sm:text-base ${
                activeTab === tab.id
                  ? "bg-blue-600 text-white shadow-md"
                  : "bg-gray-700 hover:bg-gray-600 hover:text-white"
              } ${loading ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </nav>
    );
  }