// components/Navbar.jsx
'use client';
import { useState } from 'react';
import Link from 'next/link';

function Navbar() {
  const [isOpen, setIsOpen] = useState(false);
  const [isNFTDropdownOpen, setIsNFTDropdownOpen] = useState(false);

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
          subItems: [{ name: 'E280', href: '/nft/BASE/E280' }],
        },
      ],
    },
    { name: 'About', href: '/about' },
  ];

  return (
    <nav className="nav bg-gradient-to-r from-gray-900 via-gray-800 to-gray-900 text-white sticky top-0 z-50 shadow-xl">
      <div className="nav-container flex justify-between items-center w-full px-4 sm:px-6 lg:px-8 py-4">
        {/* Logo */}
        <div className="nav-logo text-2xl font-bold tracking-tight text-orange-400 hover:text-orange-300 transition-colors">
          <Link href="/">TitanXUtils</Link>
        </div>

        {/* Desktop Links */}
        <div className="hidden md:flex items-center space-x-8">
          {navItems.map((item) => (
            <div key={item.name} className="relative group">
              <Link
                href={item.href}
                className="nav-link text-gray-100 hover:text-orange-400 transition-colors duration-300 font-semibold text-base"
              >
                {item.name}
              </Link>
              {item.subItems && (
                <div className="absolute left-0 mt-2 w-64 bg-gray-800/95 backdrop-blur-md rounded-xl shadow-2xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-300 z-60 border border-gray-700/50">
                  {item.subItems.map((subItem) => (
                    <div key={subItem.name} className="py-1">
                      <div className="nav-dropdown-item px-4 py-2 text-gray-100 hover:bg-orange-500/20 hover:text-orange-400 rounded-md transition-colors duration-200 text-sm font-medium">
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
                              className="nav-dropdown-item px-4 py-2 text-gray-100 hover:bg-orange-500/20 hover:text-orange-400 rounded-md transition-colors duration-200 text-sm font-medium"
                            >
                              <Link href={nestedItem.href}>{nestedItem.name}</Link>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="nav-toggle md:hidden p-2 rounded-full bg-orange-500/20 text-gray-100 hover:bg-orange-500/40 transition-colors duration-200"
          onClick={() => setIsOpen(!isOpen)}
          aria-label={isOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={isOpen}
        >
          <svg
            className="w-6 h-6"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
              d={isOpen ? 'M6 18L18 6M6 6l12 12' : 'M4 6h16M4 12h16M4 18h16'}
            />
          </svg>
        </button>
      </div>

      {/* Mobile Menu */}
      {isOpen && (
        <div className="md:hidden bg-gray-800/95 backdrop-blur-md px-4 py-6 space-y-4 border-t border-gray-700/50">
          {navItems.map((item) => (
            <div key={item.name} className="block">
              {item.subItems ? (
                <>
                  <div
                    className="flex justify-between items-center cursor-pointer nav-link py-3 px-4 text-gray-100 hover:text-orange-400 rounded-md transition-colors duration-200 font-semibold text-base"
                    onClick={() =>
                      item.name === 'NFT' &&
                      setIsNFTDropdownOpen(!isNFTDropdownOpen)
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        item.name === 'NFT' &&
                          setIsNFTDropdownOpen(!isNFTDropdownOpen);
                      }
                    }}
                    tabIndex={0}
                  >
                    <span>{item.name}</span>
                    {item.name === 'NFT' && (
                      <svg
                        className="w-5 h-5 transition-transform duration-200"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                        style={{ transform: isNFTDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)' }}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth="2"
                          d="M19 9l-7 7-7-7"
                        />
                      </svg>
                    )}
                  </div>
                  {item.name === 'NFT' && isNFTDropdownOpen && (
                    <div className="pl-4 space-y-2 mt-2">
                      {item.subItems.map((subItem) => (
                        <div key={subItem.name}>
                          <div className="nav-dropdown-item py-2 px-4 text-gray-100 hover:bg-orange-500/20 hover:text-orange-400 rounded-md transition-colors duration-200 text-sm font-medium">
                            {subItem.href ? (
                              <Link
                                href={subItem.href}
                                onClick={() => {
                                  setIsOpen(false);
                                  setIsNFTDropdownOpen(false);
                                }}
                              >
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
                                  className="nav-dropdown-item py-2 px-4 text-gray-100 hover:bg-orange-500/20 hover:text-orange-400 rounded-md transition-colors duration-200 text-sm font-medium"
                                >
                                  <Link
                                    href={nestedItem.href}
                                    onClick={() => {
                                      setIsOpen(false);
                                      setIsNFTDropdownOpen(false);
                                    }}
                                  >
                                    {nestedItem.name}
                                  </Link>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <Link
                  href={item.href}
                  onClick={() => setIsOpen(false)}
                  className="nav-link block py-3 px-4 text-gray-100 hover:text-orange-400 rounded-md transition-colors duration-200 font-semibold text-base"
                >
                  {item.name}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </nav>
  );
}

export default Navbar;