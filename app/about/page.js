// app/about/page.js
'use client';
import { motion } from 'framer-motion';
import Link from 'next/link';

export default function AboutPage() {
  const containerVariants = {
    hidden: { opacity: 0 },
    visible: {
      opacity: 1,
      transition: {
        staggerChildren: 0.2,
      },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
  };

  const handleDMLink = (username, e) => {
    e.preventDefault();
    const appLink = `x://messages/compose?screen_name=${username}`;
    const webLink = `https://x.com/direct_messages/create/${username}`;
    window.location = appLink;
    setTimeout(() => {
      window.open(webLink, '_blank', 'noopener,noreferrer');
    }, 500);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-800 to-gray-700 text-white">
      <main className="container pt-20 pb-16">
        <motion.section
          className="text-center mb-12"
          variants={containerVariants}
          initial="hidden"
          animate="visible"
        >
          <motion.h1
            className="text-4xl sm:text-5xl font-extrabold tracking-tight text-orange-500 mb-6"
            variants={itemVariants}
          >
            About TitanXUtils
          </motion.h1>
          <motion.p
            className="text-lg sm:text-xl text-gray-300 max-w-3xl mx-auto leading-relaxed"
            variants={itemVariants}
          >
            TitanXUtils is your premier platform for navigating the TitanX ecosystem with ease and precision.
          </motion.p>
        </motion.section>

        {/* Introduction Section */}
        <motion.section className="mb-16" variants={containerVariants} initial="hidden" animate="visible">
          <motion.div className="card" variants={itemVariants}>
            <h2 className="subtitle mb-4">Our Mission</h2>
            <p className="text-body leading-relaxed">
              TitanXUtils is a cutting-edge platform co-developed by{' '}
              <a
                href="#"
                onClick={(e) => handleDMLink('JukesTheGreat', e)}
                className="text-blue-400 hover:text-blue-300 hover:underline transition-colors duration-200"
                title="Send a DM to @JukesTheGreat on X"
              >
                @JukesTheGreat
              </a>{' '}
              and{' '}
              <a
                href="#"
                onClick={(e) => handleDMLink('KetoNatural1970', e)}
                className="text-blue-400 hover:text-blue-300 hover:underline transition-colors duration-200"
                title="Send a DM to @KetoNatural1970 on X"
              >
                @KetoNatural1970
              </a>
              . Our mission is to empower users with seamless access to TitanX's mining, auction, and minting protocols,
              alongside insightful NFT yield-bearing statistics. Built with precision and innovation, TitanXUtils is a
              community-driven tool designed to simplify and enhance your TitanX experience.
            </p>
          </motion.div>
        </motion.section>

        {/* Features Section */}
        <motion.section className="mb-16" variants={containerVariants} initial="hidden" animate="visible">
          <motion.h2 className="subtitle text-center mb-8" variants={itemVariants}>
            Why TitanXUtils?
          </motion.h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <motion.div className="card hover:shadow-xl transition-shadow duration-300" variants={itemVariants}>
              <h3 className="text-xl font-semibold text-orange-400 mb-3">Centralized Hub</h3>
              <p className="text-body">
                TitanXUtils serves as a one-stop hub for critical TitanX information, streamlining navigation across
                multiple protocols for both new and experienced users.
              </p>
            </motion.div>
            <motion.div className="card hover:shadow-xl transition-shadow duration-300" variants={itemVariants}>
              <h3 className="text-xl font-semibold text-orange-400 mb-3">Real-Time Insights</h3>
              <p className="text-body">
                Access immediate updates and detailed NFT data, including yield-bearing stats, to make informed decisions
                within the TitanX ecosystem.
              </p>
            </motion.div>
            <motion.div className="card hover:shadow-xl transition-shadow duration-300" variants={itemVariants}>
              <h3 className="text-xl font-semibold text-orange-400 mb-3">Continuous Improvement</h3>
              <p className="text-body">
                We are committed to enhancing the platform with new features, such as live ROI on auctions and performance
                optimizations, based on community feedback.
              </p>
            </motion.div>
          </div>
        </motion.section>

        {/* Team Section */}
        <motion.section className="mb-16" variants={containerVariants} initial="hidden" animate="visible">
          <motion.h2 className="subtitle text-center mb-8" variants={itemVariants}>
            Meet the Team
          </motion.h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-4xl mx-auto">
            <motion.div className="card hover:shadow-xl transition-shadow duration-300" variants={itemVariants}>
              <h3 className="text-xl font-semibold text-orange-400 mb-3">@JukesTheGreat</h3>
              <p className="text-body">
                A visionary developer with a passion for blockchain technology, JukesTheGreat drives the technical
                innovation behind TitanXUtils, ensuring a robust and user-friendly platform.
              </p>
              <a
                href="#"
                onClick={(e) => handleDMLink('JukesTheGreat', e)}
                className="btn btn-primary mt-4 inline-block"
              >
                Contact on X
              </a>
            </motion.div>
            <motion.div className="card hover:shadow-xl transition-shadow duration-300" variants={itemVariants}>
              <h3 className="text-xl font-semibold text-orange-400 mb-3">@KetoNatural1970</h3>
              <p className="text-body">
                A dedicated community advocate and strategist, KetoNatural1970 shapes the platform’s vision, focusing on
                user experience and community engagement.
              </p>
              <a
                href="#"
                onClick={(e) => handleDMLink('KetoNatural1970', e)}
                className="btn btn-primary mt-4 inline-block"
              >
                Contact on X
              </a>
            </motion.div>
          </div>
        </motion.section>

        {/* Up Next Section */}
        <motion.section className="mb-16" variants={containerVariants} initial="hidden" animate="visible">
          <motion.h2 className="subtitle text-center mb-8" variants={itemVariants}>
            Up Next...
          </motion.h2>
          <motion.div className="card max-w-3xl mx-auto" variants={itemVariants}>
            <h3 className="text-xl font-semibold text-orange-400 mb-3">Upcoming Features</h3>
            <p className="text-body leading-relaxed">
              We’re working on exciting enhancements to elevate your TitanXUtils experience. Stay tuned for:
            </p>
            <ul className="list-disc list-inside text-body mt-3">
              <li>
                <span className="font-semibold">Live ROI for Auctions</span>: Real-time return on investment metrics for
                TitanX auctions, helping you make data-driven decisions.
              </li>
              <li>
                <span className="font-semibold">Live ROI for Mining</span>: Dynamic ROI calculations for mining protocols,
                providing instant insights into your mining performance.
              </li>
            </ul>
            <p className="text-body mt-3">
              Have ideas for other features? Let us know!
            </p>
            <a
              href="#"
              onClick={(e) => handleDMLink('JukesTheGreat', e)}
              className="btn btn-primary mt-4 inline-block"
              title="Send a DM to @JukesTheGreat on X"
            >
              Share Your Ideas
            </a>
          </motion.div>
        </motion.section>

        {/* Free or Paid Section */}
        <motion.section className="mb-16" variants={containerVariants} initial="hidden" animate="visible">
          <motion.h2 className="subtitle text-center mb-8" variants={itemVariants}>
            Free or Paid?
          </motion.h2>
          <motion.div className="card max-w-3xl mx-auto" variants={itemVariants}>
            <p className="text-body leading-relaxed">
              All aspects of this site will be free to use initially until usage is analyzed. Aspects that assist you in
              making money may later be chargeable on a 1-year subscription basis.
            </p>
            <a
              href="#"
              onClick={(e) => handleDMLink('JukesTheGreat', e)}
              className="btn btn-primary mt-4 inline-block"
              title="Send a DM to @JukesTheGreat on X"
            >
              Contact Us for Details
            </a>
          </motion.div>
        </motion.section>

        {/* Feedback Section */}
        <motion.section className="text-center" variants={containerVariants} initial="hidden" animate="visible">
          <motion.h2 className="subtitle mb-6" variants={itemVariants}>
            We Value Your Feedback
          </motion.h2>
          <motion.p className="text-body max-w-2xl mx-auto mb-8" variants={itemVariants}>
            TitanXUtils is a continuous development project, and your input is crucial. Have suggestions for new features,
            such as live ROI on auctions or direct auction participation? Reach out to us on X.
          </motion.p>
          <motion.div variants={itemVariants}>
            <a
              href="#"
              onClick={(e) => handleDMLink('JukesTheGreat', e)}
              className="btn btn-primary"
              title="Send a DM to @JukesTheGreat on X"
            >
              Share Feedback
            </a>
          </motion.div>
        </motion.section>
      </main>
    </div>
  );
}