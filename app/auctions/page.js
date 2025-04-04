// app/auctions/page.js

export default function Auctions() {
  const auctions = [
    { name: 'Ascendant', url: 'https://app.ascendant.win/auction' },
    { name: 'Flare', url: 'https://www.flare.win/auction' },
    { name: 'Shogun', url: 'https://app.shogun.win/auction' },
    { name: 'Blaze', url: 'https://app.titanblaze.win/auction' },
    { name: 'Volt', url: 'https://app.volt.win/auction' }, // Fixed typo in URL (removed extra 'h')
    { name: 'Vyper', url: 'https://app.vyper.win/auction' },
    { name: 'Flux', url: 'https://app.flux.win/auction' },
    { name: 'Phoenix', url: 'https://app.phoenix.win/' },
    { name: 'Turbo', url: 'https://app.turbo.win/auction' },
    { name: 'GoatX', url: 'https://app.thegoatx.win/auction' },
  ];

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 text-white">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight text-center mb-6">
          TitanX Ecosystem Auctions
        </h1>
        <p className="mt-4 text-lg sm:text-xl text-gray-300 text-center max-w-2xl mx-auto">
          Explore the current auctions running in the TitanX ecosystem. Click any auction to visit its page.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {auctions.map((auction) => (
            <div
              key={auction.name}
              className="bg-gray-800 rounded-lg shadow-md p-6 hover:bg-gray-700 
                transition-all duration-200 hover:shadow-lg transform hover:-translate-y-1"
            >
              <a
                href={auction.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300 text-xl font-semibold 
                  transition-colors duration-200"
              >
                {auction.name} Auction
              </a>
              <p className="text-gray-400 mt-2 text-sm truncate">
                <span className="hover:underline">{auction.url}</span>
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}