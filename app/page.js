// app/page.js
'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

export default function Home() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setIsLoaded(true);
    console.log('Homepage hydrated');
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 text-gray-100">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-20 pb-16">
        <AnimatePresence>
          {isLoaded && (
            <motion.section
              initial={{ opacity: 0, y: 50 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 50 }}
              transition={{ duration: 0.8 }}
              className="text-center"
            >
              <h1 className="text-4xl sm:text-6xl font-extrabold tracking-tight">
                Welcome to TitanXUtils
              </h1>
              <p className="mt-4 text-lg sm:text-xl text-body">
                Your gateway to exploring the TitanX ecosystem. Dive into NFT protocols, auctions, mining, and more.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4">
                <Link
                  href="/mining"
                  className="flex-1 sm:w-48 bg-green-500 text-gray-100 px-6 py-3 rounded-lg shadow-lg hover:bg-green-600 transition-colors duration-200 text-center font-semibold motion-button"
                  style={{ pointerEvents: 'auto' }}
                  onClick={() => console.log('Navigating to /mining')}
                >
                  Mining
                </Link>
                <Link
                  href="/auctions"
                  className="flex-1 sm:w-48 bg-blue-500 text-gray-100 px-6 py-3 rounded-lg shadow-lg hover:bg-blue-600 transition-colors duration-200 text-center font-semibold motion-button"
                  style={{ pointerEvents: 'auto' }}
                  onClick={() => console.log('Navigating to /auctions')}
                >
                  TitanX Auctions
                </Link>
                <Link
                  href="/nft"
                  className="flex-1 sm:w-48 bg-orange-500 text-gray-100 px-6 py-3 rounded-lg shadow-lg hover:bg-orange-600 transition-colors duration-200 text-center font-semibold motion-button"
                  style={{ pointerEvents: 'auto' }}
                  onClick={() => console.log('Navigating to /nft')}
                >
                  NFT Protocols
                </Link>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}