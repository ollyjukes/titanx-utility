// app/components/SearchBar.js
export default function SearchBar({ setSearchAddress, handleSearch, loading }) {
    return (
      <div className="flex flex-col sm:flex-row gap-2 sm:gap-4 mb-4 w-full">
        <input
          type="text"
          onChange={(e) => setSearchAddress(e.target.value)}
          placeholder="Enter wallet address (0x...)"
          className="p-2 sm:p-3 w-full sm:w-96 border border-gray-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-700 disabled:cursor-not-allowed transition-shadow text-sm sm:text-base bg-gray-900 text-white"
          disabled={loading}
        />
        <button
          onClick={handleSearch}
          disabled={loading}
          className="p-2 sm:p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors shadow-md text-sm sm:text-base"
        >
          Search
        </button>
      </div>
    );
  }