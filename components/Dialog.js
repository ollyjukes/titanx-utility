// components/Dialog.js
'use client';
import { motion } from 'framer-motion';
import styles from './Dialog.module.css';

const Dialog = ({ children, isOpen, onClose }) => {
  if (!isOpen) return null;

  const modalVariants = {
    hidden: { opacity: 0, y: -50 },
    visible: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -50 },
  };

  return (
    <div className={styles.overlay} onClick={onClose}>
      <motion.div
        className={styles.dialog}
        variants={modalVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        onClick={(e) => e.stopPropagation()}
      >
        <button className={styles.closeButton} onClick={onClose}>
          ×
        </button>
        {children}
      </motion.div>
    </div>
  );
};

export default Dialog;