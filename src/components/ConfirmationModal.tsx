import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';

interface ConfirmationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  isDanger?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  isDanger = false
}) => {
  const [hoverState, setHoverState] = useState<'none' | 'confirm' | 'cancel'>('none');
  
  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <style jsx global>{`
        @keyframes travelingGlow {
          0%, 100% {
            box-shadow: 20px 0 30px -10px var(--glow-color),
                        -20px 0 30px -10px var(--glow-color),
                        0 20px 30px -10px var(--glow-color),
                        0 -20px 30px -10px var(--glow-color),
                        0 0 15px -5px var(--glow-color);
          }
          25% {
            box-shadow: 25px 0 35px -10px var(--glow-color),
                        -15px 0 25px -10px var(--glow-color),
                        0 25px 35px -10px var(--glow-color),
                        0 -15px 25px -10px var(--glow-color),
                        0 0 15px -5px var(--glow-color);
          }
          50% {
            box-shadow: 15px 0 25px -10px var(--glow-color),
                        -25px 0 35px -10px var(--glow-color),
                        0 15px 25px -10px var(--glow-color),
                        0 -25px 35px -10px var(--glow-color),
                        0 0 15px -5px var(--glow-color);
          }
          75% {
            box-shadow: 15px 0 25px -10px var(--glow-color),
                        -15px 0 25px -10px var(--glow-color),
                        0 25px 35px -10px var(--glow-color),
                        0 -25px 35px -10px var(--glow-color),
                        0 0 15px -5px var(--glow-color);
          }
        }

        .modal-glow {
          --glow-color: #0ff;
          animation: travelingGlow 4s ease-in-out infinite;
        }

        .modal-glow.danger {
          --glow-color: #ff4444;
        }

        .modal-glow.safe {
          --glow-color: #22c55e;
        }
      `}</style>

      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.9, opacity: 0 }}
        className={`relative bg-[#1A1A1A] rounded-xl shadow-xl p-6 max-w-md w-full mx-4 modal-glow ${
          hoverState === 'confirm' ? (isDanger ? 'danger' : '') : 
          hoverState === 'cancel' ? 'safe' : ''
        }`}
      >
        {/* Title */}
        <h2 className="text-xl font-semibold text-white mb-4">{title}</h2>

        {/* Message */}
        <p className="text-white/70 mb-6">{message}</p>

        {/* Buttons */}
        <div className="flex justify-end space-x-3">
          <button
            onClick={onClose}
            onMouseEnter={() => setHoverState('cancel')}
            onMouseLeave={() => setHoverState('none')}
            className="px-4 py-2 rounded-lg bg-black/20 text-white/90 hover:bg-black/30 transition-colors"
          >
            {cancelText}
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            onMouseEnter={() => setHoverState('confirm')}
            onMouseLeave={() => setHoverState('none')}
            className={`px-4 py-2 rounded-lg transition-colors ${
              isDanger 
                ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' 
                : 'bg-blue-500/20 text-blue-400 hover:bg-blue-500/30'
            }`}
          >
            {confirmText}
          </button>
        </div>
      </motion.div>
    </div>,
    document.body
  );
};

export default ConfirmationModal; 