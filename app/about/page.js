// app/about/page.js
export default function AboutPage() {
  return (
    <div className="min-h-screen bg-gray-900 text-white flex flex-col items-center justify-center p-6">
      <div className="max-w-2xl text-center">
        <h1 className="text-4xl font-bold mb-6 text-orange-500">About TitanXUtils</h1>
        <p className="text-lg text-gray-300 leading-relaxed">
        TitanXUtils is a platform co-developed by{' '}
          <span className="font-semibold text-blue-400">@JukesTheGreat</span> and{' '}
          <span className="font-semibold text-blue-400">@KetoNatural1970</span>. Designed to empower
          users with quick access to the TitanX Mining, auction and minting protocols. Included is insightful NFT yield bearing stats data, this tool reflects a commitment to precision, innovation,
          and community-driven development.
        </p>
        <p className="text-lg text-gray-300 leading-relaxed mt-4">
          Its purpose is to serve as a centralized hub for accessing critical TitanX information,
          streamlining the experience for both existing and new users. With numerous protocols to
          navigate, NFTUtils simplifies the process by providing immediate, essential updates in
          one convenient location.
        </p>
        <p className="text-lg text-gray-300 leading-relaxed mt-4">
          This is a continuos development project, and we are always looking for ways to improve the user experience. If you have any suggestions or feedback, please feel free to reach out to us on Twitter.
        </p>
        <p className="text-lg text-gray-300 leading-relaxed mt-4">
          I&apos; like to add sections on our lending and farms protocols.  to be continued...
        </p>
      </div>
    </div>
  );
}