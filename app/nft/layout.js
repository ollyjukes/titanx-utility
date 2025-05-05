// File: app/nft/layout.js
'use client';
import Navbar from '@/client/components/Navbar';
import NFTLayoutWrapper from '@/client/components/NFTLayoutWrapper';
import '@/app/global.css'; // Target global.css in app directory
import { Inter } from 'next/font/google';
import { Suspense } from 'react';

const inter = Inter({ subsets: ['latin'] });

export default function NFTLayout({ children }) {
  return (
    <NFTLayoutWrapper>
      <main className={`flex-grow container page-content ${inter.className}`}>
        <Suspense fallback={<div>Loading...</div>}>
          {children}
        </Suspense>
      </main>
      <footer className="footer">
        <p>© {new Date().getFullYear()} TitanXUtils. All rights reserved.</p>
      </footer>
    </NFTLayoutWrapper>
  );
}