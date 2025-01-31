from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from transformers import Wav2Vec2ForCTC, AutoProcessor
from datasets import load_dataset, Audio
import numpy as np
import aiohttp
import asyncio
import json
import logging
import torch
import requests
from datetime import datetime
from scipy import signal
import os
from dotenv import load_dotenv

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Constants
SAMPLE_RATE = 16000  # MMS model expects 16kHz
SILENCE_THRESHOLD = 0.005
MIN_SPEECH_DURATION = 0.3
MAX_SILENCE_DURATION = 0.7
MIN_AUDIO_ENERGY = 0.0005

# Load sensitive data from environment variables
ELEVENLABS_API_KEY = os.getenv('ELEVENLABS_API_KEY')
ELEVENLABS_VOICE_ID = os.getenv('ELEVENLABS_VOICE_ID')
LLM_API_ENDPOINT = os.getenv('LLM_API_ENDPOINT', 'https://vikpic.darkwarehou.se/v1/chat/completions')

# Validate required environment variables
if not all([ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID, LLM_API_ENDPOINT]):
    raise EnvironmentError("Missing required environment variables. Please check your .env file.")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize MMS model
logger.info("Loading MMS model...")
model_id = "facebook/mms-1b-fl102"

# Initialize processor and model with proper configuration
processor = AutoProcessor.from_pretrained(model_id)
model = Wav2Vec2ForCTC.from_pretrained(
    model_id,
    from_tf=False,
    torch_dtype=torch.float32,
)

# Set English as the target language and load adapter
processor.tokenizer.set_target_lang("eng")
model.load_adapter("eng")

# Move model to GPU if available and set to eval mode
device = "cuda" if torch.cuda.is_available() else "cpu"
model = model.to(device)
model.eval()

logger.info(f"MMS model loaded successfully with English language adapter on {device}")

# Temporary in-memory storage for conversations
conversations = []
conversation_messages = {}

# Load test dataset
logger.info("Loading test dataset...")
stream_data = load_dataset("hf-internal-testing/librispeech_asr_dummy", "clean", split="validation", streaming=True)
stream_data = stream_data.cast_column("audio", Audio(sampling_rate=SAMPLE_RATE))

@app.get("/conversations")
async def get_conversations():
    return conversations

@app.get("/conversations/{conversation_id}/messages")
async def get_conversation_messages(conversation_id: int):
    if conversation_id not in conversation_messages:
        return []
    return conversation_messages[conversation_id]

@app.post("/conversations")
async def create_conversation():
    conversation_id = len(conversations) + 1
    conversation = {
        "id": conversation_id,
        "title": f"Conversation {conversation_id}",
        "updatedAt": datetime.now().isoformat()
    }
    conversations.append(conversation)
    conversation_messages[conversation_id] = []
    return conversation

@app.get("/test_transcription")
async def test_transcription():
    """Test endpoint that uses LibriSpeech dataset to validate the model."""
    try:
        # Get a test sample
        sample = next(iter(stream_data))
        audio = sample["audio"]
        audio_data = audio["array"]
        
        logger.debug(f"Test audio shape: {audio_data.shape}, Sample rate: {audio['sampling_rate']}")
        logger.debug(f"Test audio stats - min: {np.min(audio_data):.3f}, max: {np.max(audio_data):.3f}, mean: {np.mean(audio_data):.3f}")
        
        # Process exactly like the example
        inputs = processor(audio_data, sampling_rate=SAMPLE_RATE, return_tensors="pt")
        input_values = inputs.input_values.to(device)
        
        logger.debug(f"Test input shape: {input_values.shape}")
        logger.debug(f"Test input stats - min: {torch.min(input_values):.3f}, max: {torch.max(input_values):.3f}")
        
        with torch.no_grad():
            outputs = model(input_values).logits
            
        ids = torch.argmax(outputs, dim=-1)[0]
        transcription = processor.decode(ids)
        
        logger.debug(f"Test transcription: '{transcription}'")
        logger.debug(f"Actual text: '{sample['text']}'")
        
        return {
            "transcription": transcription,
            "actual_text": sample["text"],
            "audio_shape": list(audio_data.shape),
            "input_shape": list(input_values.shape)
        }
        
    except Exception as e:
        logger.error(f"Test transcription error: {str(e)}")
        raise

async def transcribe_audio(audio_data: np.ndarray) -> str:
    try:
        # Normalize audio to [-1, 1] range if not already
        if np.abs(audio_data).max() > 1.0:
            audio_data = audio_data / np.abs(audio_data).max()
            
        # Convert to float32 and ensure correct shape
        audio_data = audio_data.astype(np.float32)
        if audio_data.ndim == 2:
            audio_data = audio_data.mean(axis=1)  # Convert stereo to mono
            
        # Process with the model's processor
        inputs = processor(audio_data, sampling_rate=SAMPLE_RATE, return_tensors="pt", padding=True)
        input_values = inputs.input_values.to(device)
        
        logger.debug(f"Model input shape: {input_values.shape}")
        logger.debug(f"Input tensor stats - min: {torch.min(input_values):.3f}, max: {torch.max(input_values):.3f}")
        
        with torch.no_grad():
            outputs = model(input_values).logits
            
        ids = torch.argmax(outputs, dim=-1)[0]
        transcription = processor.decode(ids)
        
        logger.debug(f"Transcription complete. Result: '{transcription}'")
        return transcription
        
    except Exception as e:
        logger.error(f"Error in transcribe_audio: {str(e)}")
        raise

async def get_llm_response(text: str) -> str:
    if not text.strip():
        logger.debug("Empty text received, skipping LLM")
        return ""

    url = LLM_API_ENDPOINT
    headers = {
        "Content-Type": "application/json",
    }
    data = {
        "messages": [
            {"role": "system", "content": "You are a helpful AI assistant. Keep responses concise and natural."},
            {"role": "user", "content": text},
        ],
        "model": "llama-3.1-8b-lexi-uncensored-v2",
        "temperature": 0.7,
        "max_tokens": 1000,
    }

    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(url, headers=headers, json=data, timeout=30) as response:
                if response.status != 200:
                    error_text = await response.text()
                    logger.error(f"LLM error: {error_text}")
                    raise Exception(f"LLM request failed: {error_text}")
                    
                result = await response.json()
                if not result.get("choices"):
                    logger.error(f"Unexpected LLM response: {result}")
                    raise Exception("Invalid LLM response format")
                    
                return result["choices"][0]["message"]["content"]
    except Exception as e:
        logger.error(f"LLM error: {str(e)}")
        raise

async def text_to_speech(text: str) -> bytes:
    if not text.strip():
        logger.debug("Empty text received, skipping TTS")
        return b""

    url = f"https://api.elevenlabs.io/v1/text-to-speech/{ELEVENLABS_VOICE_ID}"
    headers = {
        "Accept": "audio/mpeg",
        "Content-Type": "application/json",
        "xi-api-key": ELEVENLABS_API_KEY,
    }
    data = {
        "text": text,
        "model_id": "eleven_monolingual_v1",
        "voice_settings": {
            "stability": 0.5,
            "similarity_boost": 0.5,
        },
    }

    try:
        response = requests.post(url, json=data, headers=headers)
        if response.status_code != 200:
            logger.error(f"TTS error: {response.text}")
            raise Exception(f"Failed to generate speech: {response.text}")

        return response.content
    except Exception as e:
        logger.error(f"TTS error: {str(e)}")
        raise

def is_valid_speech(audio_data: np.ndarray) -> bool:
    """Check if the audio segment contains valid speech."""
    if len(audio_data) < SAMPLE_RATE * MIN_SPEECH_DURATION:
        logger.debug(f"Audio segment too short: {len(audio_data)/SAMPLE_RATE:.2f}s")
        return False
        
    # Apply bandpass filter to focus on speech frequencies (100-3000 Hz)
    nyquist = SAMPLE_RATE / 2
    low = 100 / nyquist
    high = 3000 / nyquist
    b, a = signal.butter(4, [low, high], btype='band')
    filtered_audio = signal.filtfilt(b, a, audio_data)
    
    # Calculate audio energy on filtered signal
    energy = np.mean(np.abs(filtered_audio))
    if energy < MIN_AUDIO_ENERGY:
        logger.debug(f"Audio energy too low: {energy:.6f}")
        return False
        
    # Check for continuous segments of speech using filtered audio
    frame_length = int(0.025 * SAMPLE_RATE)  # 25ms frames
    frames = np.array_split(filtered_audio, len(filtered_audio) // frame_length)
    frame_energies = [np.mean(np.abs(frame)) for frame in frames]
    
    # Dynamic threshold based on background noise
    background_energy = np.percentile(frame_energies, 10)  # Use 10th percentile as noise floor
    speech_threshold = max(SILENCE_THRESHOLD, background_energy * 3)
    
    speech_frames = sum(1 for e in frame_energies if e > speech_threshold)
    speech_ratio = speech_frames / len(frames)
    
    logger.debug(f"Speech analysis - Duration: {len(audio_data)/SAMPLE_RATE:.2f}s, Energy: {energy:.6f}, Speech ratio: {speech_ratio:.2f}, Background energy: {background_energy:.6f}")
    return speech_ratio > 0.15  # Lowered to 15% speech requirement

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    try:
        await websocket.accept()
        logger.info("WebSocket connection opened")

        is_connected = True
        audio_chunks = []  # Store audio chunks
        is_recording = False
        
        while is_connected:
            try:
                message = await websocket.receive()
                if not message:
                    continue

                # Handle binary data (audio chunks)
                if message.get('type') == "websocket.receive" and message.get('bytes'):
                    data = message.get('bytes')
                    
                    # Check if this is the end-of-recording signal (single zero byte)
                    if len(data) == 1 and data[0] == 0:
                        logger.debug("Received end-of-recording signal")
                        is_recording = False
                        
                        if not audio_chunks:
                            logger.debug("No audio chunks collected")
                            continue
                            
                        try:
                            # Concatenate all chunks
                            complete_audio = np.concatenate([
                                np.frombuffer(chunk, dtype=np.float32) 
                                for chunk in audio_chunks
                            ])
                            
                            # Log the complete audio stats
                            logger.debug(f"Complete audio stats - shape: {complete_audio.shape}, min: {np.min(complete_audio):.3f}, max: {np.max(complete_audio):.3f}, mean: {np.mean(complete_audio):.3f}")
                            logger.debug(f"Complete audio duration: {len(complete_audio)/SAMPLE_RATE:.2f}s")
                            
                            # Process the complete audio if it contains valid speech
                            if is_valid_speech(complete_audio):
                                try:
                                    # Transcribe complete audio
                                    text = await transcribe_audio(complete_audio)
                                    if text.strip():
                                        await websocket.send_json({"type": "user_transcription", "text": text})
                                        
                                        # Get LLM response
                                        await websocket.send_json({"type": "status", "status": "generating_response"})
                                        response = await get_llm_response(text)
                                        
                                        if response.strip():
                                            await websocket.send_json({"type": "ai_response", "text": response})
                                            
                                            # Convert response to speech
                                            await websocket.send_json({"type": "status", "status": "generating_audio"})
                                            audio_response = await text_to_speech(response)
                                            
                                            if audio_response:
                                                await websocket.send_json({"type": "status", "status": "playing_audio"})
                                                await websocket.send_bytes(audio_response)
                                except Exception as e:
                                    logger.error(f"Processing error: {str(e)}")
                                    await websocket.send_json({"error": str(e)})
                            
                            # Clear the chunks after processing
                            audio_chunks = []
                            
                        except Exception as e:
                            logger.error(f"Error processing complete audio: {str(e)}")
                            audio_chunks = []  # Clear chunks on error
                            continue
                    else:
                        # Handle regular audio chunk
                        if not is_recording:
                            logger.debug("Starting new recording")
                            is_recording = True
                            audio_chunks = []
                        
                        # Add padding if needed
                        remainder = len(data) % 4
                        if remainder != 0:
                            padding = b'\x00' * (4 - remainder)
                            data = data + padding
                            logger.debug(f"Added {4 - remainder} bytes of padding to chunk")
                        
                        # Store the chunk
                        audio_chunks.append(data)
                        logger.debug(f"Received audio chunk: {len(data)} bytes, total chunks: {len(audio_chunks)}")

                # Handle text messages (commands/status)
                elif message.get('type') == "websocket.receive" and message.get('text'):
                    try:
                        data = json.loads(message.get('text'))
                        if data.get('type') == 'debug':
                            action = data.get('action')
                            logger.debug(f"Debug message received: {data}")
                            
                            if action == 'start_recording':
                                is_recording = True
                                audio_chunks = []
                            elif action == 'stop_recording':
                                is_recording = False
                                
                    except json.JSONDecodeError:
                        logger.error("Invalid JSON message received")
                        continue

            except Exception as e:
                logger.error(f"WebSocket error: {str(e)}")
                break

    except WebSocketDisconnect:
        logger.info("WebSocket connection closed")
    except Exception as e:
        logger.error(f"WebSocket error: {str(e)}")
    finally:
        if websocket.client_state.value:
            await websocket.close()
        logger.info("WebSocket connection closed")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)