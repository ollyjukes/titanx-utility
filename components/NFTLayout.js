// components/NFTLayout.js
'use client';

import Navbar from './Navbar';

export default function NFTLayout({ children }) {
  return (
    <div className="min-h-screen bg-gray-900">
      <Navbar />
      <main className="container page-content">
        {children}
      </main>
    </div>
  );
}