'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CurrencyDollarIcon } from '@heroicons/react/24/solid';

function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isNFTDropdownOpen, setIsNFTDropdownOpen] = useState(false);
  const pathname = usePathname();

  const menuVariants = {
    hidden: { opacity: 0, y: -20 },
    visible: {
      opacity: 1,
      y: 0,
      transition: { duration: 0.3, ease: 'easeOut', staggerChildren: 0.1 },
    },
  };

  const itemVariants = {
    hidden: { opacity: 0, y: -10, scale: 0.95 },
    visible: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.2 } },
  };

  const dropdownVariants = {
    hidden: { opacity: 0, height: 0, transition: { duration: 0.2 } },
    visible: { opacity: 1, height: 'auto', transition: { duration: 0.2 } },
  };

  const navItems = [
    { name: 'Home', href: '/' },
    { name: 'Auctions', href: '/auctions' },
    { name: 'Mining', href: '/mining', icon: CurrencyDollarIcon },
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
          subItems: [{ name: 'E280', href: '/nft/BASE/E280' }],
        },
      ],
    },
    { name: 'About', href: '/about' },
  ];

  return (
    <nav className="nav bg-gray-800 text-white">
      <div className="nav-container">
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5 }}
          className="nav-logo"
        >
          <Link href="/" className="nav-link">
            TitanXUtils
          </Link>
        </motion.div>

        <div className="hidden md:flex space-x-6 items-center">
          {navItems.map((item) => (
            <motion.div
              key={item.name}
              className="relative group"
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
            >
              <Link
                href={item.href}
                className={`nav-link flex items-center space-x-1 ${
                  pathname === item.href ? 'text-orange-500' : 'text-gray-300 hover:text-orange-500'
                }`}
              >
                {item.icon && <item.icon className="h-5 w-5" />}
                <span>{item.name}</span>
              </Link>
              {item.subItems && (
                <motion.div
                  className="nav-dropdown opacity-0 group-hover:opacity-100 group-hover:mt-3 transition-all duration-200 pointer-events-none group-hover:pointer-events-auto bg-gray-700 text-white"
                  variants={dropdownVariants}
                  initial="hidden"
                  animate="hidden"
                  whileHover="visible"
                >
                  {item.subItems.map((subItem) => (
                    <div key={subItem.name} className="py-1">
                      <div className="nav-dropdown-item font-semibold">{subItem.name}</div>
                      {subItem.subItems && (
                        <div className="pl-4">
                          {subItem.subItems.map((nestedItem) => (
                            <Link
                              key={nestedItem.name}
                              href={nestedItem.href}
                              className="nav-dropdown-item hover:text-orange-500"
                            >
                              {nestedItem.name}
                            </Link>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </motion.div>
              )}
            </motion.div>
          ))}
          {/* Removed theme toggle button */}
        </div>

        <button
          className="md:hidden p-2 focus:outline-none text-gray-300 hover:text-white"
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

      <AnimatePresence>
        {isOpen && (
          <motion.div
            variants={menuVariants}
            initial="hidden"
            animate="visible"
            exit="hidden"
            className="md:hidden mt-4 space-y-2 px-4"
          >
            {navItems.map((item) => (
              <motion.div
                key={item.name}
                variants={itemVariants}
                className="nav-dropdown-item"
              >
                {item.subItems ? (
                  <>
                    <div
                      className="flex justify-between items-center cursor-pointer text-gray-300 hover:text-orange-500"
                      onClick={() =>
                        item.name === 'NFT' &&
                        setIsNFTDropdownOpen(!isNFTDropdownOpen)
                      }
                    >
                      <span>{item.name}</span>
                      {item.name === 'NFT' && (
                        <motion.svg
                          className="w-4 h-4"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          animate={{ rotate: isNFTDropdownOpen ? 180 : 0 }}
                          transition={{ duration: 0.2 }}
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
                            <div className="py-2 text-gray-300 font-semibold">
                              {subItem.name}
                            </div>
                            {subItem.subItems && (
                              <div className="pl-4 space-y-2">
                                {subItem.subItems.map((nestedItem) => (
                                  <Link
                                    key={nestedItem.name}
                                    href={nestedItem.href}
                                    className="nav-dropdown-item hover:text-orange-500"
                                    onClick={() => setIsOpen(false)}
                                  >
                                    {nestedItem.name}
                                  </Link>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </motion.div>
                    )}
                  </>
                ) : (
                  <Link
                    href={item.href}
                    className={`block flex items-center space-x-1 ${
                      pathname === item.href ? 'text-orange-500' : 'text-gray-300 hover:text-orange-500'
                    }`}
                    onClick={() => setIsOpen(false)}
                  >
                    {item.icon && <item.icon className="h-5 w-5" />}
                    <span>{item.name}</span>
                  </Link>
                )}
              </motion.div>
            ))}
            {/* Removed theme toggle button */}
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

export default Navbar;