from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
import numpy as np
import whisper
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

# Initialize Whisper model
logger.info("Starting transcription server initialization...")
logger.info("Loading Whisper model (this may take a few seconds)...")
model = whisper.load_model("base")
logger.info("Whisper model loaded successfully")

@app.post("/transcribe")
async def transcribe_audio(request: Request):
    logger.debug("Received transcription request")
    
    # Get binary audio data
    audio_data = await request.body()
    logger.debug(f"Received audio data of size: {len(audio_data)} bytes")
    
    # Convert to numpy array
    audio_array = np.frombuffer(audio_data, dtype=np.float32)
    logger.debug(f"Converted to numpy array of shape: {audio_array.shape}")
    
    # Log audio statistics for debugging
    if len(audio_array) > 0:
        logger.debug(f"Audio stats - min: {np.min(audio_array):.3f}, max: {np.max(audio_array):.3f}, mean: {np.mean(audio_array):.3f}")
    
    # Transcribe using Whisper
    try:
        logger.debug("Starting transcription...")
        result = model.transcribe(audio_array)
        transcription = result["text"].strip()
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