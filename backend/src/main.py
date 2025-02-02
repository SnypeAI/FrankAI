from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import torch
from transformers import Wav2Vec2ForCTC, AutoProcessor
import logging
import sys
import colorama
from colorama import Fore, Style
import uvicorn

# Initialize colorama for cross-platform color support
colorama.init()

# Create a custom formatter that adds colors
class ColoredFormatter(logging.Formatter):
    COLORS = {
        logging.DEBUG: Style.DIM + Fore.WHITE,
        logging.INFO: Fore.CYAN,
        logging.WARNING: Fore.YELLOW,
        logging.ERROR: Fore.RED,
        logging.CRITICAL: Fore.RED + Style.BRIGHT
    }

    def format(self, record):
        # Skip huggingface debug messages
        if record.name.startswith('transformers') or record.name.startswith('huggingface'):
            if record.levelno <= logging.INFO:
                return None

        # Add color to the level name and message
        color = self.COLORS.get(record.levelno, Style.RESET_ALL)
        
        # Check for success messages and color them green
        if record.levelno == logging.INFO and any(x in record.msg.lower() for x in ['success', 'complete', 'loaded successfully']):
            color = Fore.GREEN
        
        # Special handling for uvicorn logs to avoid duplicates
        if record.name == 'uvicorn.error' or record.name == 'uvicorn.access':
            # Skip duplicate startup messages
            if any(x in record.msg for x in ['Started server process', 'Waiting for application', 'Application startup', 'Uvicorn running']):
                if hasattr(self, '_seen_messages') and record.msg in self._seen_messages:
                    return None
                if not hasattr(self, '_seen_messages'):
                    self._seen_messages = set()
                self._seen_messages.add(record.msg)
            
            record.levelname = f"{color}{record.levelname}{Style.RESET_ALL}"
            record.msg = f"{color}{record.msg}{Style.RESET_ALL}"
            return super().format(record)
            
        record.levelname = f"{color}{record.levelname}{Style.RESET_ALL}"
        record.msg = f"{color}{record.msg}{Style.RESET_ALL}"
        
        return super().format(record)

# Set up logging with the custom formatter
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s',
    stream=sys.stdout
)

# Apply the custom formatter to all loggers
formatter = ColoredFormatter('%(levelname)s: %(message)s')
for handler in logging.getLogger().handlers:
    handler.setFormatter(formatter)

# Configure uvicorn's logger
logging.getLogger("uvicorn.error").handlers = logging.getLogger().handlers
logging.getLogger("uvicorn.access").handlers = logging.getLogger().handlers

# Filter out huggingface debug messages
logging.getLogger('transformers').setLevel(logging.WARNING)
logging.getLogger('huggingface').setLevel(logging.WARNING)

logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI()

# Add CORS middleware with specific origins
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],  # Frontend URLs
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize MMS model
logger.info("Starting transcription server initialization...")
logger.info("Loading MMS-1B model (this may take a few seconds)...")

# Load model and processor
model_name = "facebook/mms-1b-all"  # Using the fine-tuned ASR version
device = "cuda" if torch.cuda.is_available() else "cpu"
model = Wav2Vec2ForCTC.from_pretrained(model_name).to(device)
processor = AutoProcessor.from_pretrained(model_name)

logger.info(f"MMS-1B model loaded successfully on {device}")

@app.post("/transcribe")
async def transcribe_audio(request: Request):
    logger.debug("Received transcription request")
    
    try:
        # Get binary audio data
        audio_data = await request.body()
        logger.debug(f"Received audio data of size: {len(audio_data)} bytes")
        
        # Convert to numpy array
        audio_array = np.frombuffer(audio_data, dtype=np.float32).copy()
        logger.debug(f"Converted to numpy array of shape: {audio_array.shape}")
        
        # Process directly with the processor
        inputs = processor(
            audio_array, 
            sampling_rate=16000,
            return_tensors="pt"
        ).to(device)
        
        # Get logits
        with torch.no_grad():
            outputs = model(**inputs).logits
        
        # Decode
        ids = torch.argmax(outputs, dim=-1)[0]
        transcription = processor.decode(ids)
        
        logger.info(f"Transcription successful: '{transcription}'")
        return {"transcription": transcription}
        
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}", exc_info=True)
        return {"error": str(e)}

@app.get("/health")
async def health_check():
    logger.debug("Health check request received")
    return {"status": "ok"}

if __name__ == "__main__":
    logger.info("Starting uvicorn server...")
    uvicorn_config = uvicorn.Config(
        app,
        host="localhost",
        port=8000,
        log_level="info",
        loop="asyncio",
        log_config=None  # Disable uvicorn's default logging config
    )
    server = uvicorn.Server(uvicorn_config)
    server.run()