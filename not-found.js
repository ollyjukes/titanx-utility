// File: app/not-found.js

import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 flex flex-col items-center justify-center p-6">
      <h1 className="text-4xl font-bold mb-4">Page Not Found</h1>
      <p className="text-lg mb-6">Sorry, the page you&apos;re looking for doesn&apos;t exist.</p>
      <Link href="/nft" className="btn btn-primary">
        Return to NFT Collections
      </Link>
    </div>
  );
}