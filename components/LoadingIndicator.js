import { motion } from 'framer-motion';

export default function LoadingIndicator({ status, progress }) {
  const percentage = progress?.totalOwners > 0 ? (progress.totalWallets / progress.totalOwners) * 100 : 0;

  return (
    <div className="loading-container">
      <motion.svg
        className="spinner"
        animate={{ scale: [1, 1.2, 1], rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'easeInOut' }}
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </motion.svg>
      <p className="text-body">{status}</p>
      {progress?.totalOwners > 0 && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: `${percentage}%` }}></div>
        </div>
      )}
    </div>
  );
}