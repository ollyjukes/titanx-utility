// app/components/CollectionSelector.js
"use client";

import { useRouter } from 'next/navigation';

export default function CollectionSelector({ currentCollection }) {
  const router = useRouter();
  const collections = ['element280', 'stax', 'element369', 'ascendant'];

  const handleChange = (e) => {
    router.push(`/nft/ETH/${e.target.value}`);
  };

  return (
    <div className="mb-6">
      <label htmlFor="collection" className="text-lg font-semibold mr-2">Select Collection:</label>
      <select
        id="collection"
        value={currentCollection}
        onChange={handleChange}
        className="p-2 bg-gray-800 text-white rounded"
      >
        {collections.map((key) => (
          <option key={key} value={key}>
            {key.charAt(0).toUpperCase() + key.slice(1)}
          </option>
        ))}
      </select>
    </div>
  );
}