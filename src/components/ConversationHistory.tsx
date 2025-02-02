import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Trash2, MessageSquare } from 'lucide-react';
import { 
  List,
  ListItem,
  ListItemText,
  ListItemSecondaryAction,
  IconButton,
  Typography,
  Box,
  useTheme,
  alpha,
  ThemeProvider,
  createTheme,
} from '@mui/material';
import { format } from 'date-fns';
import ConfirmationModal from './ConfirmationModal';

interface Conversation {
  id: number;
  title: string;
  updated_at: string;
  message_count: number;
}

interface ConversationHistoryProps {
  isOpen: boolean;
  onClose: () => void;
  conversations: Conversation[];
  currentConversation: number | null;
  onSelectConversation: (id: number | null) => void;
}

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      paper: '#1A1A1A',
      default: '#0A0A0A',
    },
    primary: {
      main: '#3B82F6',
    },
    error: {
      main: '#EF4444',
    },
    text: {
      primary: 'rgba(255, 255, 255, 0.9)',
      secondary: 'rgba(255, 255, 255, 0.6)',
    },
    divider: 'rgba(255, 255, 255, 0.1)',
  },
});

const ConversationHistory: React.FC<ConversationHistoryProps> = ({ isOpen, onClose, conversations, currentConversation, onSelectConversation }) => {
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedConversation, setSelectedConversation] = useState<Conversation | null>(null);
  const theme = useTheme();

  const handleClose = () => {
    onClose();
  };

  const handleAnimationComplete = () => {
    if (!isOpen) {
      onClose();
    }
  };

  const handleDeleteConversation = async () => {
    if (!selectedConversation) return;
    
    try {
      const response = await fetch(`http://localhost:3001/conversations/${selectedConversation.id}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
      
      onSelectConversation(null);
      setDeleteDialogOpen(false);
      setSelectedConversation(null);
    } catch (error) {
      console.error('Error deleting conversation:', error);
    }
  };

  const formatDate = (dateString: string) => {
    try {
      return format(new Date(dateString), 'MMM d, h:mm a').replace(',', '');
    } catch {
      return format(new Date(), 'MMM d, h:mm a').replace(',', '');
    }
  };

  return (
    <ThemeProvider theme={darkTheme}>
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              key="backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.5 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 bg-black"
              onClick={handleClose}
            />
            
            {/* Panel */}
            <motion.div
              key="panel"
              initial={{ x: '-100%', opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: '-100%', opacity: 0 }}
              transition={{ 
                type: 'spring',
                stiffness: 400,
                damping: 40,
                opacity: { duration: 0.2 }
              }}
              className="fixed left-0 top-0 h-screen w-96 shadow-xl z-50"
            >
              <Box sx={{ 
                height: '100%', 
                display: 'flex', 
                flexDirection: 'column',
                bgcolor: 'background.paper',
                borderRight: 1,
                borderColor: 'divider'
              }}>
                {/* Header */}
                <Box sx={{ 
                  p: 2, 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'space-between',
                  borderBottom: 1,
                  borderColor: 'divider'
                }}>
                  <Typography variant="h6" sx={{ color: 'text.primary' }}>
                    Conversation History
                  </Typography>
                  <IconButton onClick={handleClose} size="small" sx={{ color: 'text.secondary' }}>
                    <X />
                  </IconButton>
                </Box>

                {/* Conversation List */}
                <List sx={{ 
                  flex: 1, 
                  overflow: 'auto',
                  '& .MuiListItem-root': {
                    transition: 'all 0.2s',
                    '&:hover': {
                      bgcolor: alpha(theme.palette.primary.main, 0.08)
                    }
                  }
                }}>
                  <AnimatePresence mode="popLayout">
                    {conversations.map((conversation) => (
                      <motion.div
                        key={conversation.id}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -20 }}
                        transition={{ duration: 0.2 }}
                      >
                        <ListItem
                          sx={{
                            borderBottom: 1,
                            borderColor: 'divider',
                            py: 2
                          }}
                        >
                          <ListItemText
                            primary={conversation.title}
                            secondary={
                              <Box
                                component="span"
                                sx={{ 
                                  display: 'flex', 
                                  alignItems: 'center', 
                                  gap: 1, 
                                  mt: 0.5,
                                  color: 'text.secondary'
                                }}
                              >
                                <MessageSquare size={14} />
                                <span>
                                  {conversation.message_count} messages • {formatDate(conversation.updated_at)}
                                </span>
                              </Box>
                            }
                            primaryTypographyProps={{
                              variant: "subtitle1",
                              sx: { color: 'text.primary' }
                            }}
                            secondaryTypographyProps={{
                              component: "span"
                            }}
                          />
                          <ListItemSecondaryAction>
                            <IconButton
                              edge="end"
                              onClick={() => {
                                setSelectedConversation(conversation);
                                setDeleteDialogOpen(true);
                              }}
                              sx={{ 
                                color: 'error.main',
                                '&:hover': {
                                  bgcolor: alpha(theme.palette.error.main, 0.08)
                                }
                              }}
                            >
                              <Trash2 size={18} />
                            </IconButton>
                          </ListItemSecondaryAction>
                        </ListItem>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </List>
              </Box>

              {/* Delete Confirmation Modal */}
              <ConfirmationModal
                isOpen={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                onConfirm={handleDeleteConversation}
                title="Delete Conversation"
                message={`Are you sure you want to delete "${selectedConversation?.title}"? This action cannot be undone.`}
                confirmText="Delete"
                cancelText="Cancel"
                isDanger={true}
              />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </ThemeProvider>
  );
};

export default ConversationHistory; 