// app/page.js
'use client';
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { useFlareAuctionStore } from '../lib/store';
import { useFlareAuctionState } from '../lib/auctions/protocols/flare';

export default function Home() {
  const [isLoaded, setIsLoaded] = useState(false);
  const { setFlareAuctionDay } = useFlareAuctionStore();
  const { startTimestamp, startLoading, getAuctionDayStatus } = useFlareAuctionState();

  useEffect(() => {
    setIsLoaded(true);

    // Initialize Flare auction state
    if (!startLoading && startTimestamp) {
      const currentTimestamp = Math.floor(Date.now() / 1000);
      const { isAuction, nextFlareAuctionStart } = getAuctionDayStatus(currentTimestamp);
      setFlareAuctionDay(isAuction, nextFlareAuctionStart);

      // Schedule daily update at 2 PM UTC
      const scheduleNextUpdate = () => {
        const now = new Date();
        const next2PMUTC = new Date(Date.UTC(
          now.getUTCFullYear(),
          now.getUTCMonth(),
          now.getUTCDate() + (now.getUTCHours() >= 14 ? 1 : 0),
          14, // 2 PM UTC
          0,
          0
        ));
        const timeUntilNext = next2PMUTC - now;

        setTimeout(() => {
          const newTimestamp = Math.floor(Date.now() / 1000);
          const { isAuction: newIsAuction, nextFlareAuctionStart: newNextStart } = getAuctionDayStatus(newTimestamp);
          setFlareAuctionDay(newIsAuction, newNextStart);
          scheduleNextUpdate();
        }, timeUntilNext);
      };
      scheduleNextUpdate();
    }
  }, [startLoading, startTimestamp, setFlareAuctionDay]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 text-white">
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
              <p className="mt-4 text-lg sm:text-xl text-gray-300">
                Your gateway to exploring the TitanX ecosystem. Dive into NFT protocols, auctions, and more.
              </p>
              <div className="mt-8 flex flex-col sm:flex-row justify-center gap-4">
                <motion.div
                  className="inline-block bg-orange-500 text-white px-6 py-3 rounded-lg shadow-lg hover:bg-orange-600 transition-colors duration-200"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Link href="/nft">NFT Protocols</Link>
                </motion.div>
                <motion.div
                  className="inline-block bg-blue-500 text-white px-6 py-3 rounded-lg shadow-lg hover:bg-blue-600 transition-colors duration-200"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                >
                  <Link href="/auctions">TitanX Auctions</Link>
                </motion.div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}