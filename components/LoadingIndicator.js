// app/components/LoadingIndicator.js
import { motion } from 'framer-motion';

export default function LoadingIndicator({ status }) {
  return (
    <div className="flex flex-col items-center justify-center py-8">
      <motion.div
        className="w-16 h-16 border-4 border-blue-500 border-t-transparent rounded-full"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
      />
      <p className="mt-4 text-lg text-gray-300">{status}</p>
    </div>
  );
}