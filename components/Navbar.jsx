// components/Navbar.jsx
'use client';
import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';

function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isNFTDropdownOpen, setIsNFTDropdownOpen] = useState(false);

  const menuVariants = {
    hidden: { opacity: 0, y: -20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.3, ease: 'easeOut', staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: -10 },
    visible: { opacity: 1, y: 0 },
  };

  const dropdownVariants = {
    hidden: { opacity: 0, height: 0 },
    visible: { opacity: 1, height: 'auto', transition: { duration: 0.2 } },
  };

  const navItems = [
    { name: 'Home', href: '/' },
    { name: 'Auctions', href: '/auctions' },
    { name: 'Mining', href: '/mining' },
    {
      name: 'NFT',
      href: '/nft',
      subItems: [
        {
          name: 'ETH',
          subItems: [
            { name: 'Element280', href: '/nft/ETH/Element280' },
            { name: 'Element369', href: '/nft/ETH/Element369' },
            { name: 'Stax', href: '/nft/ETH/Stax' },
            { name: 'Ascendant', href: '/nft/ETH/Ascendant' },
          ],
        },
        {
          name: 'BASE',
          subItems: [
            { name: 'E280', href: '/nft/BASE/E280' },
          ],
        },
      ],
    },
    { name: 'About', href: '/about' },
  ];

  return (
    <nav className="bg-gradient-to-r from-gray-900 to-gray-800 text-white p-4 sticky top-0 z-50 shadow-md">
      <div className="max-w-7xl mx-auto flex justify-between items-center">
        {/* Logo */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="text-2xl font-bold"
        >
          <Link href="/">TitanXUtils</Link>
        </motion.div>

        {/* Desktop Links */}
        <div className="hidden md:flex space-x-6 items-center">
          {navItems.map((item) => (
            <motion.div
              key={item.name}
              className="relative text-gray-300 hover:text-white transition-colors duration-200 group"
              whileHover={{ scale: 1.1, color: '#f97316' }}
              whileTap={{ scale: 0.95 }}
            >
              {item.external ? (
                <a href={item.href} target="_blank" rel="noopener noreferrer">
                  {item.name}
                </a>
              ) : (
                <Link href={item.href}>{item.name}</Link>
              )}
              {item.subItems && (
                <motion.div
                  className="absolute left-0 mt-2 w-48 bg-gray-800 rounded-md shadow-lg hidden group-hover:block"
                  variants={dropdownVariants}
                  initial="hidden"
                  whileHover="visible"
                >
                  {item.subItems.map((subItem) => (
                    <div key={subItem.name} className="py-1">
                      <div className="px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white">
                        {subItem.href ? (
                          <Link href={subItem.href}>{subItem.name}</Link>
                        ) : (
                          <span>{subItem.name}</span>
                        )}
                      </div>
                      {subItem.subItems && (
                        <div className="pl-4">
                          {subItem.subItems.map((nestedItem) => (
                            <div
                              key={nestedItem.name}
                              className="px-4 py-2 text-gray-300 hover:bg-gray-700 hover:text-white"
                            >
                              <Link href={nestedItem.href}>
                                {nestedItem.name}
                              </Link>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          ))}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden p-2 focus:outline-none"
          onClick={() => setIsOpen(!isOpen)}
        >
          <motion.svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            animate={{ rotate: isOpen ? 90 : 0 }}
            transition={{ duration: 0.3 }}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d={isOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}
            />
          </motion.svg>
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            variants={menuVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="md:hidden mt-4 space-y-2"
          >
            {navItems.map((item) => (
              <motion.div
                key={item.name}
                variants={itemVariants}
                className="block py-2 px-4 text-gray-300 hover:text-white hover:bg-gray-700 rounded-md transition-colors duration-200"
              >
                {item.subItems ? (
                  <>
                    <div
                      className="flex justify-between items-center cursor-pointer"
                      onClick={() =>
                        item.name === 'NFT' &&
                        setIsNFTDropdownOpen(!isNFTDropdownOpen)
                      }
                    >
                      {item.name}
                      {item.name === 'NFT' && (
                        <motion.svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          animate={{ rotate: isNFTDropdownOpen ? 180 : 0 }}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth="2"
                            d="M19 9l-7 7-7-7"
                          />
                        </motion.svg>
                      )}
                    </div>
                    {item.name === 'NFT' && isNFTDropdownOpen && (
                      <motion.div
                        variants={dropdownVariants}
                        initial="hidden"
                        animate="visible"
                        exit="hidden"
                        className="pl-4 space-y-2"
                      >
                        {item.subItems.map((subItem) => (
                          <div key={subItem.name}>
                            <div className="py-2">
                              {subItem.href ? (
                                <Link href={subItem.href} onClick={() => setIsOpen(false)}>
                                  {subItem.name}
                                </Link>
                              ) : (
                                <span>{subItem.name}</span>
                              )}
                            </div>
                            {subItem.subItems && (
                              <div className="pl-4 space-y-2">
                                {subItem.subItems.map((nestedItem) => (
                                  <div
                                    key={nestedItem.name}
                                    className="py-2"
                                    onClick={() => setIsOpen(false)}
                                  >
                                    <Link href={nestedItem.href}>
                                      {nestedItem.name}
                                    </Link>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </>
                ) : item.external ? (
                  <a
                    href={item.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => setIsOpen(false)}
                  >
                    {item.name}
                  </a>
                ) : (
                  <Link href={item.href} onClick={() => setIsOpen(false)}>
                    {item.name}
                  </Link>
                )}
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default Navbar;