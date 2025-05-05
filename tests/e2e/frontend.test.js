// tests/e2e/frontend.test.js
import { jest } from '@jest/globals';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { act } from 'react-dom/test-utils';
import NFTLayout from '@/components/NFTLayout';
import NFTPage from '@/components/NFTPage';
import SearchResultsModal from '@/components/SearchResultsModal';
import NFTSummary from '@/components/NFTSummary';
import HolderTable from '@/components/HolderTable';
import Navbar from '@/components/Navbar';
import LoadingIndicator from '@/components/LoadingIndicator';
import { useNFTStore } from '@/app/store';
import config from '@/config';
import { clientLogger } from '@/lib/clientLogger';
import * as fetchCollectionData from '@/lib/fetchCollectionData';
import { usePathname } from 'next/navigation';
import { viem } from 'viem';

// Mock dependencies
jest.mock('next/navigation', () => ({
  usePathname: jest.fn(),
}));
jest.mock('node-fetch', () => jest.fn());
jest.mock('viem', () => ({
  createPublicClient: jest.fn().mockReturnValue({
    multicall: jest.fn(),
  }),
  http: jest.fn(),
}));
jest.mock('@/lib/clientLogger', () => ({
  clientLogger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));
jest.mock('@/app/store', () => ({
  useNFTStore: jest.fn(),
}));
jest.mock('@/lib/fetchCollectionData', () => ({
  fetchCollectionData: jest.fn(),
}));
jest.mock('framer-motion', () => ({
  motion: {
    div: jest.fn(({ children, ...props }) => <div {...props}>{children}</div>),
    button: jest.fn(({ children, ...props }) => <button {...props}>{children}</button>),
    AnimatePresence: jest.fn(({ children }) => <>{children}</>),
  },
}));
jest.mock('next/dynamic', () => jest.fn((loader) => {
  const Component = () => <div>Mocked Dynamic Component</div>;
  Component.displayName = 'MockedDynamicComponent';
  return Component;
}));
jest.mock('react-chartjs-2', () => ({
  Bar: jest.fn(() => <div>Mocked Bar Chart</div>),
}));

// Mock config
jest.mock('@/config', () => ({
  contractDetails: {
    element280: { name: 'Element280', apiEndpoint: '/api/holders/Element280', pageSize: 100, disabled: false, rewardToken: 'ELMNT' },
    ascendant: { name: 'Ascendant', apiEndpoint: '/api/holders/Ascendant', pageSize: 1000, disabled: false, rewardToken: 'DRAGONX' },
    e280: { name: 'E280', apiEndpoint: '/api/holders/E280', pageSize: 1000, disabled: true, rewardToken: 'E280' },
    element369: { name: 'Element369', apiEndpoint: '/api/holders/Element369', pageSize: 1000, disabled: false, rewardToken: 'INFERNO/FLUX/E280' },
    stax: { name: 'Stax', apiEndpoint: '/api/holders/Stax', pageSize: 1000, disabled: false, rewardToken: 'X28' },
  },
  contractAddresses: { element280: { address: '0x7F090d101936008a26Bf1F0a22a5f92fC0Cf46c9' } },
  vaultAddresses: { element280: { address: '0x44c4ADAc7d88f85d3D33A7f856Ebc54E60C31E97' } },
  abis: { element280: { main: [], vault: [] } },
  alchemy: { apiKey: 'rzv6zozYQsbMIjcRuHg8HA8a4O5IhYYI', timeoutMs: 30000, maxRetries: 2, batchDelayMs: 500 },
  contractTiers: {
    element280: { tierOrder: [{ tierId: '1', name: 'Common' }, { tierId: '2', name: 'Common Amped' }, { tierId: '3', name: 'Rare' }, { tierId: '4', name: 'Rare Amped' }, { tierId: '5', name: 'Legendary' }, { tierId: '6', name: 'Legendary Amped' }] },
    ascendant: { tierOrder: [{ tierId: '1', name: 'Tier 1' }, { tierId: '2', name: 'Tier 2' }, { tierId: '3', name: 'Tier 3' }, { tierId: '4', name: 'Tier 4' }, { tierId: '5', name: 'Tier 5' }, { tierId: '6', name: 'Tier 6' }, { tierId: '7', name: 'Tier 7' }, { tierId: '8', name: 'Tier 8' }] },
    element369: { tierOrder: [{ tierId: '1', name: 'Common' }, { tierId: '2', name: 'Rare' }, { tierId: '3', name: 'Legendary' }] },
    stax: { tierOrder: [{ tierId: '1', name: 'Common' }, { tierId: '2', name: 'Common Amped' }, { tierId: '3', name: 'Common Super' }, { tierId: '4', name: 'Common LFG' }, { tierId: '5', name: 'Rare' }, { tierId: '6', name: 'Rare Amped' }, { tierId: '7', name: 'Rare Super' }, { tierId: '8', name: 'Rare LFG' }, { tierId: '9', name: 'Legendary' }, { tierId: '10', name: 'Legendary Amped' }, { tierId: '11', name: 'Legendary Super' }, { tierId: '12', name: 'Legendary LFG' }] },
  },
  supportedChains: ['ETH', 'BASE'],
  nftContracts: {
    element280: { name: 'Element280', chain: 'ETH', disabled: false },
    ascendant: { name: 'Ascendant', chain: 'ETH', disabled: false },
    e280: { name: 'E280', chain: 'BASE', disabled: true },
    element369: { name: 'Element369', chain: 'ETH', disabled: false },
    stax: { name: 'Stax', chain: 'ETH', disabled: false },
  },
}));

describe('Frontend Components', () => {
  let mockFetch;
  let mockUseNFTStore;
  let mockUsePathname;

  beforeEach(() => {
    jest.clearAllMocks();
    mockFetch = jest.spyOn(global, 'fetch').mockImplementation(() => Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
      text: () => Promise.resolve(''),
      body: { getReader: () => ({
        read: jest.fn().mockResolvedValue({ done: true }),
      }) },
    }));
    mockUseNFTStore = useNFTStore.mockReturnValue({
      getCache: jest.fn().mockReturnValue(null),
      setCache: jest.fn(),
    });
    mockUsePathname = usePathname.mockReturnValue('/');
    viem.createPublicClient().multicall.mockResolvedValue([
      { status: 'success', result: BigInt(1000) },
      { status: 'success', result: [100, 200, 300, 400, 500, 600] },
      { status: 'success', result: BigInt(500) },
      { status: 'success', result: BigInt(1000e18) },
    ]);
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  describe('NFTLayout', () => {
    it('renders loading state on server-side', () => {
      render(<NFTLayout />);
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('handles valid address search and opens modal', async () => {
      render(<NFTLayout />);
      const input = screen.getByPlaceholderText('Search by wallet address (e.g., 0x...)');
      const searchButton = screen.getByText('Search');

      await act(async () => {
        fireEvent.change(input, { target: { value: '0x1234567890abcdef1234567890abcdef12345678' } });
        await new Promise(resolve => setTimeout(resolve, 600));
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({
          holders: [{ wallet: '0x1234567890abcdef1234567890abcdef12345678', total: 1 }],
          totalTokens: 100,
          totalBurned: 10,
        }),
      });

      await act(async () => {
        fireEvent.click(searchButton);
      });

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('?address=0x1234567890abcdef1234567890abcdef12345678'),
          expect.any(Object)
        );
        expect(screen.getByText(/NFT Ownership for 0x1234...5678/)).toBeInTheDocument();
      });
    });

    it('displays error for invalid address', async () => {
      render(<NFTLayout />);
      const input = screen.getByPlaceholderText('Search by wallet address (e.g., 0x...)');
      const searchButton = screen.getByText('Search');

      await act(async () => {
        fireEvent.change(input, { target: { value: 'invalid_address' } });
        fireEvent.click(searchButton);
      });

      expect(screen.getByText('Please enter a valid Ethereum address (e.g., 0x...)')).toBeInTheDocument();
    });

    it('handles chain selection', async () => {
      render(<NFTLayout />);
      const ethButton = screen.getByText('ETH');

      await act(async () => {
        fireEvent.click(ethButton);
      });

      expect(screen.getByText('Element280')).toBeInTheDocument();
      expect(screen.getByText('Ascendant')).toBeInTheDocument();
    });

    it('shows disabled message for E280', async () => {
      render(<NFTLayout />);
      const baseButton = screen.getByText('BASE');
      const e280Button = screen.getByText('E280');

      await act(async () => {
        fireEvent.click(baseButton);
        fireEvent.click(e280Button);
      });

      expect(screen.getByText('Contract not yet deployed. Coming soon...')).toBeInTheDocument();
    });
  });

  describe('NFTPage', () => {
    it('renders loading state on server-side', () => {
      render(<NFTPage chain="ETH" contract="element280" />);
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });

    it('fetches and displays Element280 data', async () => {
      fetchCollectionData.fetchCollectionData.mockResolvedValue({
        holders: [{ wallet: '0x1234567890abcdef1234567890abcdef12345678', total: 1 }],
        totalTokens: 100,
        totalBurned: 10,
        totalMinted: 110,
        totalLive: 100,
        tierDistribution: [10, 20, 30, 40, 50, 60],
        burnedDistribution: [1, 2, 3, 4, 5, 6],
        multiplierPool: 500,
        totalRewardPool: 1000,
      });

      render(<NFTPage chain="ETH" contract="element280" />);

      await waitFor(() => {
        expect(screen.getByText('Element280 Holders')).toBeInTheDocument();
        expect(screen.getByText('Total Minted: 110')).toBeInTheDocument();
        expect(screen.getByText('Total Live: 100')).toBeInTheDocument();
        expect(screen.getByText('Total Burned: 10')).toBeInTheDocument();
      });
    });

    it('handles disabled contract', async () => {
      render(<NFTPage chain="BASE" contract="e280" />);
      await waitFor(() => {
        expect(screen.getByText('E280 is not yet supported (contract not deployed).')).toBeInTheDocument();
      });
    });

    it('displays chart for Element280', async () => {
      fetchCollectionData.fetchCollectionData.mockResolvedValue({
        holders: [],
        totalTokens: 100,
        totalBurned: 10,
        totalMinted: 110,
        totalLive: 100,
        tierDistribution: [10, 20, 30, 40, 50, 60],
        burnedDistribution: [1, 2, 3, 4, 5, 6],
      });

      render(<NFTPage chain="ETH" contract="element280" />);
      const chartButton = await screen.findByText('Show Tier Distribution');

      await act(async () => {
        fireEvent.click(chartButton);
      });

      expect(screen.getByText('Mocked Bar Chart')).toBeInTheDocument();
    });
  });

  describe('SearchResultsModal', () => {
    it('renders loading state', () => {
      render(
        <SearchResultsModal
          isOpen={true}
          isLoading={true}
          searchResult={{}}
          searchAddress="0x1234567890abcdef1234567890abcdef12345678"
          closeModal={jest.fn()}
          handleBackgroundClick={jest.fn()}
        />
      );
      expect(screen.getByText('Loading search results...')).toBeInTheDocument();
    });

    it('displays search results for valid address', () => {
      const searchResult = {
        element280: {
          holders: [{ wallet: '0x1234567890abcdef1234567890abcdef12345678', total: 1 }],
          totalTokens: 100,
        },
        ascendant: { error: 'No NFTs owned' },
      };
      render(
        <SearchResultsModal
          isOpen={true}
          isLoading={false}
          searchResult={searchResult}
          searchAddress="0x1234567890abcdef1234567890abcdef12345678"
          closeModal={jest.fn()}
          handleBackgroundClick={jest.fn()}
        />
      );
      expect(screen.getByText(/NFT Ownership for 0x1234...5678/)).toBeInTheDocument();
      expect(screen.getByText('Element280')).toBeInTheDocument();
      expect(screen.getByText('Error: No NFTs owned')).toBeInTheDocument();
    });

    it('closes modal on background click', async () => {
      const closeModal = jest.fn();
      const handleBackgroundClick = jest.fn(e => e.target.classList.contains('modal-overlay') && closeModal());
      render(
        <SearchResultsModal
          isOpen={true}
          isLoading={false}
          searchResult={{}}
          searchAddress=""
          closeModal={closeModal}
          handleBackgroundClick={handleBackgroundClick}
        />
      );

      const overlay = screen.getByTestId('modal-overlay') || document.querySelector('.modal-overlay');
      await act(async () => {
        fireEvent.click(overlay);
      });

      expect(closeModal).toHaveBeenCalled();
    });
  });

  describe('NFTSummary', () => {
    it('displays collection summaries', () => {
      const collectionsData = [
        { apiKey: 'element280', data: { totalTokens: 100, holders: [{ wallet: '0x123' }], totalBurned: 10 } },
        { apiKey: 'ascendant', data: { error: 'No data available' } },
      ];
      render(<NFTSummary collectionsData={collectionsData} />);
      expect(screen.getByText('Element280')).toBeInTheDocument();
      expect(screen.getByText('Total Tokens: 100')).toBeInTheDocument();
      expect(screen.getByText('No data available')).toBeInTheDocument();
    });
  });

  describe('HolderTable', () => {
    it('renders loading state for Element280', () => {
      render(<HolderTable contract="element280" holders={[]} loading={true} totalTokens={0} rewardToken="ELMNT" />);
      expect(screen.getByText('Loading Element280 data...')).toBeInTheDocument();
    });

    it('displays holders for Element280', () => {
      const holders = [
        {
          wallet: '0x1234567890abcdef1234567890abcdef12345678',
          total: 5,
          tiers: [2, 3, 0, 0, 0, 0],
          claimableRewards: 100,
          percentage: 10,
          displayMultiplierSum: 50,
        },
      ];
      render(<HolderTable contract="element280" holders={holders} loading={false} totalTokens={100} rewardToken="ELMNT" />);
      expect(screen.getByText('Total Tokens: 100')).toBeInTheDocument();
      expect(screen.getByText('0x1234...5678')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument();
    });

    it('renders loading state for Ascendant', () => {
      render(<HolderTable contract="ascendant" holders={[]} loading={true} totalTokens={0} rewardToken="DRAGONX" />);
      expect(screen.getByText('Loading Ascendant data...')).toBeInTheDocument();
    });

    it('displays holders for Ascendant', () => {
      const holders = [
        {
          wallet: '0x1234567890abcdef1234567890abcdef12345678',
          total: 5,
          shares: 100,
          lockedAscendant: 50,
          pendingDay8: 10,
          pendingDay28: 20,
          pendingDay90: 30,
          claimableRewards: 100,
          percentage: 10,
        },
      ];
      render(<HolderTable contract="ascendant" holders={holders} loading={false} totalTokens={100} rewardToken="DRAGONX" />);
      expect(screen.getByText('Total Tokens: 100')).toBeInTheDocument();
      expect(screen.getByText('0x1234...5678')).toBeInTheDocument();
      expect(screen.getByText('5')).toBeInTheDocument();
      expect(screen.getByText('100')).toBeInTheDocument(); // Shares
      expect(screen.getByText('50')).toBeInTheDocument(); // Locked Ascendant
      expect(screen.getByText('100')).toBeInTheDocument(); // Claimable Rewards
    });

    it('renders loading state for Stax', () => {
      render(<HolderTable contract="stax" holders={[]} loading={true} totalTokens={0} rewardToken="X28" />);
      expect(screen.getByText('Loading Stax data...')).toBeInTheDocument();
    });

    it('displays holders for Stax', () => {
      const holders = [
        {
          wallet: '0x1234567890abcdef1234567890abcdef12345678',
          total: 3,
          tiers: [1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
          claimableRewards: 50,
          percentage: 5,
          displayMultiplierSum: 3.6,
        },
      ];
      render(<HolderTable contract="stax" holders={holders} loading={false} totalTokens={100} rewardToken="X28" />);
      expect(screen.getByText('Total Tokens: 100')).toBeInTheDocument();
      expect(screen.getByText('0x1234...5678')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
      expect(screen.getByText('3.6')).toBeInTheDocument(); // Multiplier Sum
      expect(screen.getByText('50')).toBeInTheDocument(); // Claimable Rewards
    });

    it('renders loading state for Element369', () => {
      render(<HolderTable contract="element369" holders={[]} loading={true} totalTokens={0} rewardToken="INFERNO/FLUX/E280" />);
      expect(screen.getByText('Loading Element369 data...')).toBeInTheDocument();
    });

    it('displays holders for Element369', () => {
      const holders = [
        {
          wallet: '0x1234567890abcdef1234567890abcdef12345678',
          total: 2,
          tiers: [1, 1, 0],
          infernoRewards: 10,
          fluxRewards: 20,
          e280Rewards: 30,
          percentage: 2,
          displayMultiplierSum: 11,
        },
      ];
      render(<HolderTable contract="element369" holders={holders} loading={false} totalTokens={100} rewardToken="INFERNO/FLUX/E280" />);
      expect(screen.getByText('Total Tokens: 100')).toBeInTheDocument();
      expect(screen.getByText('0x1234...5678')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('11')).toBeInTheDocument(); // Multiplier Sum
      expect(screen.getByText('10')).toBeInTheDocument(); // Inferno Rewards
      expect(screen.getByText('20')).toBeInTheDocument(); // Flux Rewards
      expect(screen.getByText('30')).toBeInTheDocument(); // E280 Rewards
    });

    it('handles large dataset for Element280', async () => {
      const holders = Array(1000).fill().map((_, i) => ({
        wallet: `0x${i.toString(16).padStart(40, '0')}`,
        total: 5,
        tiers: [2, 3, 0, 0, 0, 0],
        claimableRewards: 100,
        percentage: 0.1,
        displayMultiplierSum: 50,
      }));
      render(<HolderTable contract="element280" holders={holders} loading={false} totalTokens={5000} rewardToken="ELMNT" />);
      expect(screen.getByText('Total Tokens: 5000')).toBeInTheDocument();
      expect(screen.getByText('0x0000...0000')).toBeInTheDocument();
      expect(screen.getByText('0x03e7...03e7')).toBeInTheDocument(); // Last wallet
      expect(screen.getAllByText('5').length).toBeGreaterThan(0);
    });

    it('handles empty holders', () => {
      render(<HolderTable contract="element280" holders={[]} loading={false} totalTokens={0} rewardToken="ELMNT" />);
      expect(screen.getByText('No holders found.')).toBeInTheDocument();
    });
  });

  describe('Navbar', () => {
    it('renders navigation items', () => {
      render(<Navbar />);
      expect(screen.getByText('TitanXUtils')).toBeInTheDocument();
      expect(screen.getByText('NFT')).toBeInTheDocument();
      expect(screen.getByText('Auctions')).toBeInTheDocument();
    });

    it('toggles mobile menu', async () => {
      render(<Navbar />);
      const menuButton = screen.getByRole('button', { name: /menu/i });

      await act(async () => {
        fireEvent.click(menuButton);
      });

      expect(screen.getByText('Element280')).toBeInTheDocument();

      await act(async () => {
        fireEvent.click(menuButton);
      });

      await waitFor(() => {
        expect(screen.queryByText('Element280')).not.toBeInTheDocument();
      });
    });

    it('expands NFT dropdown on mobile', async () => {
      render(<Navbar />);
      const menuButton = screen.getByRole('button', { name: /menu/i });
      await act(async () => {
        fireEvent.click(menuButton);
      });

      const nftItem = screen.getByText('NFT');
      await act(async () => {
        fireEvent.click(nftItem);
      });

      expect(screen.getByText('ETH')).toBeInTheDocument();
      expect(screen.getByText('BASE')).toBeInTheDocument();
    });
  });

  describe('LoadingIndicator', () => {
    it('renders loading status and progress', () => {
      render(<LoadingIndicator status="Loading..." progress={{ progressPercentage: 50 }} />);
      expect(screen.getByText('Loading...')).toBeInTheDocument();
      expect(screen.getByTestId('progress-bar') || document.querySelector('.bg-blue-600')).toHaveStyle({ width: '50%' });
    });
  });
});