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
              <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4 max-w-3xl mx-auto">
                <Link href="/mining" passHref>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="btn btn-primary w-full sm:w-40 shadow-lg hover:shadow-xl transition-shadow duration-200"
                    aria-label="Navigate to Mining page"
                  >
                    Mining
                  </motion.button>
                </Link>
                <Link href="/auctions" passHref>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="btn btn-primary w-full sm:w-40 shadow-lg hover:shadow-xl transition-shadow duration-200"
                    aria-label="Navigate to Auctions page"
                  >
                    TitanX Auctions
                  </motion.button>
                </Link>
                <Link href="/nft" passHref>
                  <motion.button
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    className="btn btn-primary w-full sm:w-40 shadow-lg hover:shadow-xl transition-shadow duration-200"
                    aria-label="Navigate to NFT Protocols page"
                  >
                    NFT Protocols
                  </motion.button>
                </Link>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}