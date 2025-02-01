from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import torch
from transformers import Wav2Vec2ForCTC, AutoProcessor
import logging
import sys

# Set up logging with a more detailed format
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s.%(msecs)03d %(levelname)s: %(message)s',
    datefmt='%H:%M:%S',
    stream=sys.stdout  # Ensure logs go to stdout for the Node.js runner
)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
    import uvicorn
    logger.info("Starting uvicorn server...")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="debug")