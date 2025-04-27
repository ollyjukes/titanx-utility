export const barChartOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top', labels: { color: '#e5e7eb' } }, // Gray-200
      title: {
        display: true,
        text: 'NFT Tier Distribution',
        color: '#e5e7eb',
        font: { size: 16, weight: 'bold' },
      },
    },
    scales: {
      y: {
        beginAtZero: true,
        title: { display: true, text: 'Number of NFTs', color: '#e5e7eb' },
        ticks: { color: '#d1d5db' }, // Gray-300
      },
      x: {
        title: { display: true, text: 'Tiers', color: '#e5e7eb' },
        ticks: { color: '#d1d5db' },
      },
    },
  };