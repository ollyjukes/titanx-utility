import { memo } from 'react';

function LoadingIndicator({ status, progress }) {
  return (
    <div className="flex flex-col items-center justify-center p-6 bg-gray-800 rounded-lg">
      <svg className="animate-spin h-8 w-8 text-blue-500" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
      </svg>
      <p className="mt-4 text-gray-200">{status}</p>
      {progress && (
        <div className="mt-2 w-64 bg-gray-700 rounded-full h-2.5">
          <div
            className="bg-blue-600 h-2.5 rounded-full"
            style={{ width: `${progress.progressPercentage}%` }}
          />
        </div>
      )}
    </div>
  );
}

export default memo(LoadingIndicator);